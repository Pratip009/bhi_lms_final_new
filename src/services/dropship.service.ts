import { Resend } from 'resend';
import mongoose from 'mongoose';
import { connectDB } from '@/lib/db';
import DropshipApplication, {
  IDropshipApplication,
} from '@/models/DropshipApplication';
import DropshipOrder, { IDropshipOrder } from '@/models/DropshipOrder';
import Product from '@/models/Product';
import { createPayPalOrder, capturePayPalOrder } from './paypal.service';
import {
  getShipEngineRates,
  purchaseLabelFromRate,
} from './shipengine.service';
import {
  STORE_ORIGIN,
  DEFAULT_PACKAGE,
  applyShippingServiceFee,
} from '@/lib/shipping-config';
import { buildTrackingUrl } from '@/models/ORDER_SHIPPING_FIELDS';
import type { ShippingAddress } from '@/types/shipping';
import { signShippingQuote, verifyShippingQuote } from '@/lib/dropshipQuote';
import {
  dropshipApplicationReceivedEmailHtml,
  adminNewDropshipApplicationEmailHtml,
  dropshipApplicationApprovedEmailHtml,
  dropshipApplicationRejectedEmailHtml,
  dropshipOrderConfirmationEmailHtml,
  dropshipOrderPaymentFailedEmailHtml,
  adminNewDropshipOrderEmailHtml,
} from '@/lib/email-templates';

const resend = new Resend(process.env.RESEND_API_KEY);
const EMAIL_FROM = process.env.EMAIL_FROM || 'noreply@alphagemstone.com';
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://alphagemstone.com';
const ADMIN_NOTIFICATION_EMAILS = (process.env.ADMIN_NOTIFICATION_EMAILS || '')
  .split(',')
  .map((e) => e.trim())
  .filter(Boolean);

/** Max units of a single product per dropship order — a sanity cap, real stock is enforced atomically. */
export const DROPSHIP_MAX_QUANTITY = 50;
/** Unpaid orders give their reserved stock back after this long (they can still be paid later if stock is still there). */
const UNPAID_STOCK_HOLD_MINUTES = 60;
/** Unpaid orders are cancelled outright after this many days. */
const UNPAID_AUTO_CANCEL_DAYS = 7;
/** How long one capture attempt may hold the capture lock. */
const CAPTURE_LOCK_MS = 60 * 1000;

export class DropshipError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

function portalUrlFor(application: { portalToken: string }): string {
  return `${SITE_URL}/drop-shipping/portal/${application.portalToken}`;
}

function assertObjectId(id: string, what = 'Order'): void {
  if (!mongoose.isValidObjectId(id)) throw new DropshipError(`${what} not found`, 404);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Every seller-facing action goes through here: the token must exist, the
 * application must be approved, and the seller must not be deactivated.
 */
async function requireActiveSeller(token: string) {
  if (!token || typeof token !== 'string' || token.length < 20) {
    throw new DropshipError('Invalid portal link', 404);
  }
  const application = await DropshipApplication.findOne({ portalToken: token });
  if (!application) throw new DropshipError('Invalid portal link', 404);
  if (application.status !== 'approved') {
    throw new DropshipError('Your dropship application is not yet approved', 403);
  }
  if (application.active === false) {
    throw new DropshipError(
      'This dropship account has been deactivated. Contact Alpha Gemstone for help.',
      403
    );
  }
  return application;
}

/**
 * Atomically takes `quantity` units of stock, never dipping into units held
 * for memos. Returns the updated product, or null if not enough is free.
 */
async function reserveStock(productId: unknown, quantity: number) {
  return Product.findOneAndUpdate(
    {
      _id: productId,
      isActive: { $ne: false },
      $expr: {
        $gte: [
          { $subtract: ['$stock', { $ifNull: ['$reservedForMemo', 0] }] },
          quantity,
        ],
      },
    },
    { $inc: { stock: -quantity } },
    { new: true }
  );
}

async function releaseStock(productId: unknown, quantity: number) {
  await Product.findByIdAndUpdate(productId, { $inc: { stock: quantity } });
}

/** Exported for routes (e.g. the seller catalog) that only need to gate access. */
export async function requireActiveDropshipSeller(token: string) {
  await connectDB();
  return requireActiveSeller(token);
}

// ─── Applications ─────────────────────────────────────────────────────────────

export interface ApplyForDropshipInput {
  fullName: string;
  businessName?: string;
  email: string;
  phone?: string;
  website?: string;
  sellingChannels?: string[];
  message?: string;
}

/**
 * Creates an application — unless this email already has one that's
 * pending or approved. In that case no duplicate is created; an approved
 * seller who lost their private link simply gets it emailed again (only to
 * their own address, so this reveals nothing to whoever submitted the form).
 */
export async function applyForDropship(
  input: ApplyForDropshipInput
): Promise<IDropshipApplication> {
  await connectDB();

  const email = input.email.trim().toLowerCase();
  const existing = await DropshipApplication.findOne({
    email,
    status: { $in: ['pending', 'approved'] },
  }).sort({ createdAt: -1 });

  if (existing) {
    if (existing.status === 'approved' && existing.active !== false) {
      void sendApplicationApprovedEmail(existing);
    }
    return existing;
  }

  const application = await DropshipApplication.create({
    fullName: input.fullName,
    businessName: input.businessName,
    email,
    phone: input.phone,
    website: input.website,
    sellingChannels: input.sellingChannels || [],
    message: input.message,
  });

  void sendApplicationReceivedEmail(application);
  void sendAdminNewApplicationEmail(application);

  return application;
}

export async function adminListApplications(params: {
  status?: string;
  page?: number;
  limit?: number;
}) {
  await connectDB();
  const limit = params.limit ?? 20;
  const page = Math.max(1, params.page ?? 1);
  const filter =
    params.status && ['pending', 'approved', 'rejected'].includes(params.status)
      ? { status: params.status }
      : {};

  const [applications, total, pendingCount] = await Promise.all([
    DropshipApplication.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    DropshipApplication.countDocuments(filter),
    DropshipApplication.countDocuments({ status: 'pending' }),
  ]);

  return {
    applications,
    total,
    pendingCount,
    page,
    pages: Math.ceil(total / limit),
  };
}

export type AdminApplicationAction =
  | { action: 'approve' }
  | { action: 'reject'; reason?: string }
  | { action: 'deactivate' }
  | { action: 'reactivate' };

export async function adminUpdateApplication(
  applicationId: string,
  reviewerId: string,
  input: AdminApplicationAction
): Promise<IDropshipApplication> {
  await connectDB();
  assertObjectId(applicationId, 'Application');

  const application = await DropshipApplication.findById(applicationId);
  if (!application) throw new DropshipError('Application not found', 404);

  if (input.action === 'approve') {
    application.status = 'approved';
    application.active = true;
    application.reviewedAt = new Date();
    application.reviewedBy = reviewerId;
    await application.save();
    void sendApplicationApprovedEmail(application);
  } else if (input.action === 'reject') {
    application.status = 'rejected';
    application.reviewedAt = new Date();
    application.reviewedBy = reviewerId;
    application.rejectionReason = input.reason;
    await application.save();
    void sendApplicationRejectedEmail(application);
  } else if (input.action === 'deactivate') {
    // Instantly cuts off the seller's private link — checked on every
    // portal load and every order/payment action.
    application.active = false;
    await application.save();
  } else if (input.action === 'reactivate') {
    application.active = true;
    await application.save();
  }

  return application;
}

export async function getApplicationByToken(
  token: string
): Promise<IDropshipApplication | null> {
  await connectDB();
  return DropshipApplication.findOne({ portalToken: token }).lean() as any;
}

// ─── Shipping ─────────────────────────────────────────────────────────────────

export interface ShippingDestinationInput {
  street1: string;
  street2?: string;
  city: string;
  state: string;
  postalCode: string;
  country?: string;
}

/**
 * Live ShipEngine/ShipStation rates for a dropship order, using the same
 * store origin/package defaults and tiered service fee as normal checkout.
 * Every rate comes back with a signed `quoteToken` — the ONLY thing the
 * order submit accepts as proof of the shipping price (see dropshipQuote.ts).
 */
export async function getDropshipShippingRates(
  token: string,
  destination: ShippingDestinationInput
) {
  await connectDB();
  await requireActiveSeller(token);

  // ShipStation rejects anything but an exact 2-letter code for US/CA.
  const state = (destination.state || '').trim().toUpperCase();
  if (state.length !== 2) {
    throw new DropshipError(
      'Please select a valid state/province before getting shipping rates.',
      400
    );
  }
  const country = (destination.country || 'US').trim().toUpperCase();

  const destAddr: ShippingAddress = {
    fullName: 'Dropship Customer',
    street1: destination.street1,
    street2: destination.street2,
    city: destination.city,
    state,
    postalCode: destination.postalCode,
    country,
  };

  const rates = await getShipEngineRates(STORE_ORIGIN, destAddr, DEFAULT_PACKAGE);
  const quoteAddress = { ...destination, state, country };

  return rates.map((r) => ({
    ...r,
    costWithFee: applyShippingServiceFee(r.rate),
    quoteToken: signShippingQuote(token, quoteAddress, {
      rateId: r.rateId,
      rate: r.rate,
      carrier: r.carrier,
      service: r.service,
      serviceCode: r.serviceCode,
      estimatedDays: r.estimatedDays ?? null,
      estimatedDelivery: r.estimatedDelivery ?? null,
    }),
  }));
}

// ─── Orders ───────────────────────────────────────────────────────────────────

export interface SubmitDropshipOrderInput {
  productId: string;
  quantity?: number;
  specifications?: string;
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  postalCode: string;
  country?: string;
  /** Signed token from getDropshipShippingRates — the price comes from here, never from the client. */
  shippingQuote: string;
  specialInstructions?: string;
  /** Random id from the browser, reused on retries, so double-submits can't create duplicates. */
  clientRequestId?: string;
}

/**
 * Creates a dropship order against a real, active catalog product and
 * atomically reserves its stock. The order starts as pending_payment and
 * is NOT handed to fulfillment until PayPal payment is captured.
 *
 * Price safety: product price is read from the DB; shipping price comes
 * from a server-signed quote bound to this seller and this exact address.
 * Duplicate safety: the same clientRequestId always returns the same order.
 */
export async function submitDropshipOrder(
  token: string,
  input: SubmitDropshipOrderInput
): Promise<IDropshipOrder> {
  await connectDB();
  const application = await requireActiveSeller(token);

  assertObjectId(input.productId, 'Product');

  // Idempotency — a retried submit returns the order it already created.
  if (input.clientRequestId) {
    const already = await DropshipOrder.findOne({
      application: application._id,
      clientRequestId: input.clientRequestId,
    });
    if (already) return already;
  }

  const state = input.state.trim().toUpperCase();
  const country = (input.country || 'US').trim().toUpperCase();

  const verification = verifyShippingQuote(input.shippingQuote, token, {
    street1: input.addressLine1,
    street2: input.addressLine2,
    city: input.city,
    state,
    postalCode: input.postalCode,
    country,
  });
  if (!verification.ok) throw new DropshipError(verification.reason, 400);
  const quote = verification.quote;

  const quantity = Math.floor(Number(input.quantity) || 1);
  if (quantity < 1 || quantity > DROPSHIP_MAX_QUANTITY) {
    throw new DropshipError(`Quantity must be between 1 and ${DROPSHIP_MAX_QUANTITY}.`, 400);
  }

  const product = await reserveStock(input.productId, quantity);
  if (!product) {
    const exists = await Product.findById(input.productId).select('stock reservedForMemo isActive').lean() as any;
    if (!exists || exists.isActive === false) {
      throw new DropshipError('That product is no longer available.', 409);
    }
    const free = Math.max(0, (exists.stock ?? 0) - (exists.reservedForMemo ?? 0));
    throw new DropshipError(
      free > 0
        ? `Only ${free} available right now — please lower the quantity.`
        : 'That product just went out of stock.',
      409
    );
  }
  if (!(typeof product.price === 'number' && product.price > 0)) {
    await releaseStock(product._id, quantity).catch(() => {});
    throw new DropshipError('This product has no price set. Please contact Alpha Gemstone.', 409);
  }

  const productAmount = round2(product.price * quantity);
  const shippingCost = applyShippingServiceFee(quote.rate);
  const serviceFee = round2(shippingCost - quote.rate);
  const amount = round2(productAmount + shippingCost);

  try {
    const order = await DropshipOrder.create({
      application: application._id,
      sellerBusinessName: application.businessName || application.fullName,
      sellerEmail: application.email,
      product: product._id,
      productName: product.name,
      productImage: Array.isArray((product as any).images) && (product as any).images.length
        ? (product as any).images[0]
        : (product as any).image,
      unitPrice: product.price,
      quantity,
      productAmount,
      amount,
      specifications: input.specifications,
      customerName: input.customerName,
      customerEmail: input.customerEmail || undefined,
      customerPhone: input.customerPhone,
      addressLine1: input.addressLine1,
      addressLine2: input.addressLine2,
      city: input.city,
      state,
      postalCode: input.postalCode,
      country,
      shippingCarrier: quote.carrier,
      shippingService: quote.service,
      shippingServiceCode: quote.serviceCode,
      shippingRateId: quote.rateId,
      shippingRate: quote.rate,
      shippingCost,
      serviceFee,
      shippingEstimatedDays: quote.estimatedDays ?? undefined,
      shippingEstimatedDelivery: quote.estimatedDelivery ?? undefined,
      specialInstructions: input.specialInstructions,
      stockReserved: true,
      clientRequestId: input.clientRequestId,
    });
    return order;
  } catch (err: any) {
    // Order creation failed after stock was reserved — give it back.
    await releaseStock(product._id, quantity).catch(() => {});
    // Lost a race with our own retry (same clientRequestId) — return the winner.
    if (err?.code === 11000 && input.clientRequestId) {
      const winner = await DropshipOrder.findOne({
        application: application._id,
        clientRequestId: input.clientRequestId,
      });
      if (winner) return winner;
    }
    throw err;
  }
}

/** Fields a seller may see on their own orders — no internal notes, ids or label files. */
const SELLER_ORDER_FIELDS =
  '_id productName productImage product unitPrice quantity productAmount amount specifications ' +
  'customerName customerEmail customerPhone addressLine1 addressLine2 city state postalCode country ' +
  'shippingCarrier shippingService shippingCost serviceFee shippingRate shippingEstimatedDays ' +
  'shippingEstimatedDelivery status paymentStatus stockReserved trackingNumber trackingUrl ' +
  'shippedAt paidAt cancelledAt specialInstructions createdAt updatedAt';

export async function listOrdersForToken(
  token: string
): Promise<{ application: IDropshipApplication; orders: IDropshipOrder[] } | null> {
  await connectDB();
  if (!token || typeof token !== 'string') return null;
  const application = await DropshipApplication.findOne({
    portalToken: token,
  }).lean();
  if (!application) return null;

  const orders = await DropshipOrder.find({ application: (application as any)._id })
    .select(SELLER_ORDER_FIELDS)
    .sort({ createdAt: -1 })
    .limit(500)
    .lean();

  return { application: application as any, orders: orders as any };
}

/**
 * Seller cancels one of their own orders. Only possible while it's unpaid;
 * any reserved stock goes straight back to inventory.
 */
export async function sellerCancelOrder(token: string, orderId: string): Promise<IDropshipOrder> {
  await connectDB();
  const application = await requireActiveSeller(token);
  assertObjectId(orderId);

  // Conditional update — can't cancel something that got paid a moment ago.
  const order = await DropshipOrder.findOneAndUpdate(
    {
      _id: orderId,
      application: application._id,
      paymentStatus: { $ne: 'completed' },
      status: 'pending_payment',
      $or: [{ captureLockUntil: { $exists: false } }, { captureLockUntil: { $lt: new Date() } }],
    },
    { $set: { status: 'cancelled', cancelledAt: new Date(), cancelledBy: 'seller' } },
    { new: false }
  );
  if (!order) {
    const current = await DropshipOrder.findOne({ _id: orderId, application: application._id });
    if (!current) throw new DropshipError('Order not found', 404);
    if (current.paymentStatus === 'completed') {
      throw new DropshipError('This order is already paid, so it can’t be cancelled here. Please contact Alpha Gemstone.', 409);
    }
    if (current.status === 'cancelled') return current;
    throw new DropshipError('This order is being paid right now. Please wait a moment and refresh.', 409);
  }

  if (order.stockReserved) {
    const released = await DropshipOrder.findOneAndUpdate(
      { _id: order._id, stockReserved: true },
      { $set: { stockReserved: false } }
    );
    if (released) await releaseStock(order.product, order.quantity).catch(() => {});
  }

  return (await DropshipOrder.findById(order._id))!;
}

/**
 * Starts PayPal checkout for a pending, unpaid dropship order and returns
 * the PayPal order id for the smart buttons. If the order's stock hold
 * lapsed (see releaseStaleDropshipOrders) it is re-reserved first, so an
 * order can never be paid for stock that's no longer there.
 */
export async function initiateDropshipPayment(
  token: string,
  orderId: string
): Promise<{ paypalOrderId: string; amount: number }> {
  await connectDB();
  const application = await requireActiveSeller(token);
  assertObjectId(orderId);

  const order = await DropshipOrder.findOne({ _id: orderId, application: application._id });
  if (!order) throw new DropshipError('Order not found', 404);
  if (order.paymentStatus === 'completed') {
    throw new DropshipError('This order has already been paid.', 409);
  }
  if (order.status !== 'pending_payment') {
    throw new DropshipError('This order was cancelled and can no longer be paid. Please place a new order.', 409);
  }

  if (!order.stockReserved) {
    const product = await reserveStock(order.product, order.quantity);
    if (!product) {
      throw new DropshipError(
        'Sorry — this item sold out while the order was unpaid. Please cancel this order and choose another product.',
        409
      );
    }
    const claimed = await DropshipOrder.findOneAndUpdate(
      { _id: order._id, stockReserved: false },
      { $set: { stockReserved: true } }
    );
    // Someone else re-reserved at the same moment — give ours back.
    if (!claimed) await releaseStock(order.product, order.quantity).catch(() => {});
  }

  const paypalOrder = await createPayPalOrder(order.amount);
  await DropshipOrder.updateOne(
    { _id: order._id, paymentStatus: { $ne: 'completed' } },
    { $set: { paypalOrderId: paypalOrder.id, paymentStatus: 'pending' } }
  );

  return { paypalOrderId: paypalOrder.id, amount: order.amount };
}

/**
 * Captures a PayPal payment for a dropship order.
 *
 *  - A token can only capture its OWN order (looked up by orderId + application + paypalOrderId).
 *  - A short lock guarantees two simultaneous calls never both capture / both update.
 *  - A cancelled order is refused BEFORE money is taken.
 *  - The captured amount must match the order total, or it's flagged for the admin.
 *  - A failed capture never overwrites an order that another call already marked paid.
 *  - If stock had lapsed, it's re-reserved; if that's impossible the order is flagged, never lost.
 */
export async function captureDropshipPayment(
  token: string,
  orderId: string,
  paypalOrderId: string
): Promise<IDropshipOrder> {
  await connectDB();
  const application = await requireActiveSeller(token);
  assertObjectId(orderId);
  if (!paypalOrderId || typeof paypalOrderId !== 'string') {
    throw new DropshipError('Missing PayPal order reference.', 400);
  }

  const existing = await DropshipOrder.findOne({ _id: orderId, application: application._id });
  if (!existing) throw new DropshipError('Order not found', 404);
  if (existing.paymentStatus === 'completed') return existing; // duplicate call — already done
  if (existing.paypalOrderId !== paypalOrderId) {
    throw new DropshipError('This payment does not belong to this order. Please try paying again.', 400);
  }
  if (existing.status === 'cancelled') {
    throw new DropshipError('This order was cancelled, so no payment was taken. Please place a new order.', 409);
  }

  // Take the capture lock.
  const now = new Date();
  const locked = await DropshipOrder.findOneAndUpdate(
    {
      _id: existing._id,
      paymentStatus: { $ne: 'completed' },
      status: 'pending_payment',
      $or: [{ captureLockUntil: { $exists: false } }, { captureLockUntil: { $lt: now } }],
    },
    { $set: { captureLockUntil: new Date(now.getTime() + CAPTURE_LOCK_MS) } },
    { new: true }
  );
  if (!locked) {
    const fresh = await DropshipOrder.findById(existing._id);
    if (fresh?.paymentStatus === 'completed') return fresh;
    throw new DropshipError('This payment is already being processed. Please wait a moment and refresh.', 409);
  }

  let captureData: any;
  try {
    captureData = await capturePayPalOrder(paypalOrderId);
  } catch (err) {
    console.error(`[dropship] PayPal capture threw for order ${locked._id}:`, err);
    await DropshipOrder.updateOne(
      { _id: locked._id, paymentStatus: { $ne: 'completed' } },
      { $set: { paymentStatus: 'failed' }, $unset: { captureLockUntil: 1 } }
    );
    void sendPaymentFailedEmail(locked, application);
    throw new DropshipError('Payment could not be completed. No money was taken — please try again.', 402);
  }

  if (captureData?.status !== 'COMPLETED') {
    await DropshipOrder.updateOne(
      { _id: locked._id, paymentStatus: { $ne: 'completed' } },
      { $set: { paymentStatus: 'failed' }, $unset: { captureLockUntil: 1 } }
    );
    void sendPaymentFailedEmail(locked, application);
    throw new DropshipError('Payment was not completed. Please try again.', 402);
  }

  // ── Money has been taken from here on. Never throw a "try again" error. ──
  const capture = captureData.purchase_units?.[0]?.payments?.captures?.[0];
  const capturedAmount = Number(capture?.amount?.value);
  const capturedCurrency = capture?.amount?.currency_code;

  const attention: string[] = [];
  if (Number.isFinite(capturedAmount) && Math.abs(capturedAmount - locked.amount) > 0.01) {
    attention.push(`PayPal captured $${capturedAmount.toFixed(2)} but the order total is $${locked.amount.toFixed(2)}.`);
  }
  if (capturedCurrency && capturedCurrency !== 'USD') {
    attention.push(`Payment was captured in ${capturedCurrency}, not USD.`);
  }

  // Make sure the stock is actually held for this paid order.
  const current = await DropshipOrder.findById(locked._id);
  let stockReserved = current?.stockReserved ?? locked.stockReserved;
  if (!stockReserved) {
    const product = await reserveStock(locked.product, locked.quantity);
    if (product) {
      stockReserved = true;
    } else {
      attention.push('Paid, but the item is no longer in stock. Contact the seller to arrange a substitute or refund.');
    }
  }

  const update: Record<string, unknown> = {
    paymentStatus: 'completed',
    status: 'processing',
    paidAt: new Date(),
    paypalPaymentId: capture?.id,
    stockReserved,
  };
  if (attention.length) {
    update.needsAttention = true;
    update.attentionReason = attention.join(' ');
  }

  let saved: IDropshipOrder | null = null;
  for (let attempt = 0; attempt < 3 && !saved; attempt++) {
    try {
      saved = await DropshipOrder.findByIdAndUpdate(
        locked._id,
        { $set: update, $unset: { captureLockUntil: 1 } },
        { new: true }
      );
    } catch (err) {
      if (attempt < 2) await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
      else console.error('[dropship] could not save captured payment', err);
    }
  }

  if (!saved) {
    console.error(
      `[CRITICAL] Dropship PayPal payment ${paypalOrderId} captured but order ${locked._id} could not be marked paid.`
    );
    void sendAdminAlertEmail(
      'URGENT: dropship payment captured but not recorded',
      `PayPal order ${paypalOrderId} was captured for dropship order ${locked._id} (${locked.sellerEmail}) but the database update failed. Mark it paid manually.`
    );
    throw new DropshipError(
      `Your payment went through, but we hit a problem finalizing the order. Please do NOT pay again — ` +
        `contact us with reference ${locked._id.toString().slice(-8).toUpperCase()}.`,
      500
    );
  }

  if (attention.length) {
    void sendAdminAlertEmail(
      `Dropship order needs attention — #${saved._id.toString().slice(-8).toUpperCase()}`,
      attention.join('\n')
    );
  }

  void sendOrderPaidEmail(saved, application);
  void sendAdminNewOrderEmail(saved);

  // Auto-purchase the ShipEngine label using the rate the seller picked —
  // best-effort; a failure never undoes the payment and can be retried by admin.
  if (saved.shippingRateId && stockReserved) {
    try {
      saved = await purchaseAndSaveDropshipLabel(saved);
    } catch (err) {
      console.error(`[ShipEngine] Auto-label failed for dropship order ${saved._id}:`, err);
    }
  }

  return saved;
}

/**
 * Purchases a ShipEngine label for a paid dropship order using its stored
 * shippingRateId. Safe to call more than once — an existing label is kept.
 * `markShipped` is used for admin-triggered purchases (matches normal orders,
 * where buying the label by hand moves the order to "shipped").
 */
export async function purchaseAndSaveDropshipLabel(
  order: IDropshipOrder,
  { markShipped = false }: { markShipped?: boolean } = {}
): Promise<IDropshipOrder> {
  if (order.paymentStatus !== 'completed') {
    throw new DropshipError('Cannot purchase a label before payment is completed.', 409);
  }
  if (order.status === 'cancelled') {
    throw new DropshipError('This order is cancelled — no label was purchased.', 409);
  }
  if (order.labelId) return order; // already purchased — no-op

  if (!order.shippingRateId) {
    throw new DropshipError('This order has no shipping rate on file.', 400);
  }

  const label = await purchaseLabelFromRate(order.shippingRateId);
  const trackingUrl = buildTrackingUrl(order.shippingCarrier ?? null, label.trackingNumber);

  const updated = await DropshipOrder.findByIdAndUpdate(
    order._id,
    {
      $set: {
        labelId: label.labelId,
        labelUrl: label.labelUrl,
        trackingNumber: label.trackingNumber,
        trackingUrl: trackingUrl ?? undefined,
        shippedAt: new Date(),
        ...(markShipped ? { status: 'shipped' } : {}),
      },
    },
    { new: true }
  );
  return updated ?? order;
}

/** Admin manual retry when auto-purchase-on-payment failed or needs redoing. */
export async function adminPurchaseDropshipLabel(orderId: string): Promise<IDropshipOrder> {
  await connectDB();
  assertObjectId(orderId);
  const order = await DropshipOrder.findById(orderId);
  if (!order) throw new DropshipError('Order not found', 404);
  return purchaseAndSaveDropshipLabel(order, { markShipped: true });
}

export async function adminListOrders(params: {
  status?: string;
  page?: number;
  limit?: number;
}) {
  await connectDB();
  const limit = params.limit ?? 20;
  const page = Math.max(1, params.page ?? 1);
  const filter =
    params.status &&
    ['pending_payment', 'processing', 'shipped', 'delivered', 'cancelled'].includes(
      params.status
    )
      ? { status: params.status }
      : {};

  const [orders, total, pipeline] = await Promise.all([
    DropshipOrder.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('application', 'fullName businessName email')
      .lean(),
    DropshipOrder.countDocuments(filter),
    getPipelineCounts(),
  ]);

  return { orders, total, page, pages: Math.ceil(total / limit), pipeline };
}

/** Simple funnel counts for the admin "at a glance" dashboard. */
export async function getPipelineCounts() {
  await connectDB();
  const [
    applicantsPending,
    applicantsApproved,
    ordersAwaitingPayment,
    ordersPaid,
    ordersShipped,
    ordersDelivered,
  ] = await Promise.all([
    DropshipApplication.countDocuments({ status: 'pending' }),
    DropshipApplication.countDocuments({ status: 'approved' }),
    DropshipOrder.countDocuments({ paymentStatus: { $ne: 'completed' }, status: 'pending_payment' }),
    DropshipOrder.countDocuments({ paymentStatus: 'completed', status: 'processing' }),
    DropshipOrder.countDocuments({ status: 'shipped' }),
    DropshipOrder.countDocuments({ status: 'delivered' }),
  ]);
  return {
    applicantsPending,
    applicantsApproved,
    ordersAwaitingPayment,
    ordersPaid,
    ordersShipped,
    ordersDelivered,
  };
}

export interface AdminOrderUpdateInput {
  status?: 'pending_payment' | 'processing' | 'shipped' | 'delivered' | 'cancelled';
  trackingNumber?: string;
  trackingUrl?: string;
  shippingCarrier?: string;
  adminNotes?: string;
  needsAttention?: boolean;
}

export async function adminUpdateOrder(
  orderId: string,
  input: AdminOrderUpdateInput
): Promise<IDropshipOrder> {
  await connectDB();
  assertObjectId(orderId);
  const order = await DropshipOrder.findById(orderId);
  if (!order) throw new DropshipError('Order not found', 404);

  if (input.status && input.status !== order.status) {
    const movingIntoFulfillment = ['processing', 'shipped', 'delivered'].includes(input.status);
    // Only a PAID order may move into the shipping process.
    if (movingIntoFulfillment && order.paymentStatus !== 'completed') {
      throw new DropshipError(
        'This dropship order has not been paid yet. It can only move to Processing / Shipped / Delivered after the seller pays.',
        409
      );
    }
    if (input.status === 'pending_payment' && order.paymentStatus === 'completed') {
      throw new DropshipError('This order is already paid — it can’t go back to “awaiting payment”.', 409);
    }
    if (movingIntoFulfillment && order.status === 'cancelled' && !order.stockReserved) {
      // Un-cancelling a paid order — take the stock back out again.
      const product = await reserveStock(order.product, order.quantity);
      if (!product) {
        throw new DropshipError('Can’t reopen this order — the item is out of stock now.', 409);
      }
      order.stockReserved = true;
    }
    if (input.status === 'cancelled') {
      if (order.stockReserved) {
        await releaseStock(order.product, order.quantity).catch(() => {});
        order.stockReserved = false;
      }
      order.cancelledAt = new Date();
      order.cancelledBy = 'admin';
      if (order.paymentStatus === 'completed') {
        order.needsAttention = true;
        order.attentionReason =
          'Cancelled after payment — remember to refund the seller in PayPal.';
      }
    }
    if (input.status === 'shipped' && !order.shippedAt) order.shippedAt = new Date();
    order.status = input.status;
  }

  if (input.shippingCarrier !== undefined) order.shippingCarrier = input.shippingCarrier;
  if (input.trackingNumber !== undefined) {
    order.trackingNumber = input.trackingNumber;
    if (input.trackingUrl === undefined && input.trackingNumber) {
      order.trackingUrl =
        buildTrackingUrl(input.shippingCarrier ?? order.shippingCarrier ?? null, input.trackingNumber) ?? undefined;
    }
  }
  if (input.trackingUrl !== undefined) order.trackingUrl = input.trackingUrl;
  if (input.adminNotes !== undefined) order.adminNotes = input.adminNotes;
  if (input.needsAttention === false) {
    order.needsAttention = false;
    order.attentionReason = undefined;
  }

  await order.save();
  return order;
}

/** Admin delete. Gives reserved stock back for unpaid orders so nothing gets stuck. */
export async function adminDeleteOrder(orderId: string): Promise<boolean> {
  await connectDB();
  assertObjectId(orderId);
  const order = await DropshipOrder.findByIdAndDelete(orderId);
  if (!order) return false;
  if (order.stockReserved && order.paymentStatus !== 'completed') {
    await releaseStock(order.product, order.quantity).catch(() => {});
  }
  return true;
}

/**
 * Backstop for abandoned dropship orders (called from the
 * release-stale-orders cron):
 *  - unpaid for > UNPAID_STOCK_HOLD_MINUTES → stock goes back on the shelf
 *    (the order stays open; paying later re-reserves if still available)
 *  - unpaid for > UNPAID_AUTO_CANCEL_DAYS → the order is cancelled
 */
export async function releaseStaleDropshipOrders(): Promise<{ released: number; cancelled: number }> {
  await connectDB();
  const holdCutoff = new Date(Date.now() - UNPAID_STOCK_HOLD_MINUTES * 60 * 1000);
  const cancelCutoff = new Date(Date.now() - UNPAID_AUTO_CANCEL_DAYS * 24 * 60 * 60 * 1000);
  const notLocked = {
    $or: [{ captureLockUntil: { $exists: false } }, { captureLockUntil: { $lt: new Date() } }],
  };

  let released = 0;
  const holding = await DropshipOrder.find({
    status: 'pending_payment',
    paymentStatus: { $ne: 'completed' },
    stockReserved: true,
    updatedAt: { $lt: holdCutoff },
    ...notLocked,
  }).select('_id product quantity').lean();

  for (const o of holding as any[]) {
    const claimed = await DropshipOrder.findOneAndUpdate(
      { _id: o._id, stockReserved: true, paymentStatus: { $ne: 'completed' }, ...notLocked },
      { $set: { stockReserved: false } }
    );
    if (claimed) {
      await releaseStock(o.product, o.quantity).catch(() => {});
      released++;
    }
  }

  const cancelRes = await DropshipOrder.updateMany(
    {
      status: 'pending_payment',
      paymentStatus: { $ne: 'completed' },
      stockReserved: false,
      createdAt: { $lt: cancelCutoff },
      ...notLocked,
    },
    { $set: { status: 'cancelled', cancelledAt: new Date(), cancelledBy: 'system' } }
  );

  return { released, cancelled: cancelRes.modifiedCount ?? 0 };
}

/** Paid dropship orders with a label that haven't been marked delivered yet (for the delivery-sync cron). */
export async function getDropshipOrdersAwaitingDeliverySync() {
  await connectDB();
  return DropshipOrder.find({
    status: { $in: ['processing', 'shipped'] },
    labelId: { $nin: [null, ''] },
  })
    .select('_id labelId status')
    .lean() as unknown as Array<{ _id: any; labelId: string; status: string }>;
}

export async function markDropshipOrderDelivered(orderId: string): Promise<boolean> {
  await connectDB();
  const res = await DropshipOrder.updateOne(
    { _id: orderId, status: { $in: ['processing', 'shipped'] } },
    { $set: { status: 'delivered' } }
  );
  return (res.modifiedCount ?? 0) > 0;
}

async function sendAdminAlertEmail(subject: string, text: string): Promise<void> {
  try {
    if (ADMIN_NOTIFICATION_EMAILS.length === 0) return;
    const { error } = await resend.emails.send({
      from: EMAIL_FROM,
      to: ADMIN_NOTIFICATION_EMAILS,
      subject,
      html: `<div style="font-family:sans-serif;font-size:14px;line-height:1.6">${text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/\n/g, '<br>')}<br><br><a href="${SITE_URL}/admin/orders?source=dropship">Open Orders in admin</a></div>`,
    });
    if (error) console.error('[dropshipAdminAlert] Resend error:', error);
  } catch (err) {
    console.error('[dropshipAdminAlert] Failed:', err);
  }
}

// ─── Email helpers ────────────────────────────────────────────────────────────

async function sendApplicationReceivedEmail(
  application: IDropshipApplication
): Promise<void> {
  try {
    const { error } = await resend.emails.send({
      from: EMAIL_FROM,
      to: application.email,
      subject: 'We received your Alpha Gemstone Dropship application',
      html: dropshipApplicationReceivedEmailHtml({ fullName: application.fullName }),
    });
    if (error) console.error('[dropshipApplicationReceivedEmail] Resend error:', error);
  } catch (err) {
    console.error('[dropshipApplicationReceivedEmail] Failed:', err);
  }
}

async function sendAdminNewApplicationEmail(
  application: IDropshipApplication
): Promise<void> {
  try {
    if (ADMIN_NOTIFICATION_EMAILS.length === 0) return;
    const { error } = await resend.emails.send({
      from: EMAIL_FROM,
      to: ADMIN_NOTIFICATION_EMAILS,
      subject: `New Dropship Application — ${application.fullName}`,
      html: adminNewDropshipApplicationEmailHtml({
        applicationId: application._id.toString(),
        fullName: application.fullName,
        businessName: application.businessName,
        email: application.email,
        phone: application.phone,
        website: application.website,
        sellingChannels: application.sellingChannels,
      }),
    });
    if (error) console.error('[adminNewDropshipApplicationEmail] Resend error:', error);
  } catch (err) {
    console.error('[adminNewDropshipApplicationEmail] Failed:', err);
  }
}

async function sendApplicationApprovedEmail(
  application: IDropshipApplication
): Promise<void> {
  try {
    const { error } = await resend.emails.send({
      from: EMAIL_FROM,
      to: application.email,
      subject: "You're approved — Alpha Gemstone Dropship Program",
      html: dropshipApplicationApprovedEmailHtml({
        fullName: application.fullName,
        portalUrl: portalUrlFor(application),
      }),
    });
    if (error) console.error('[dropshipApplicationApprovedEmail] Resend error:', error);
  } catch (err) {
    console.error('[dropshipApplicationApprovedEmail] Failed:', err);
  }
}

async function sendApplicationRejectedEmail(
  application: IDropshipApplication
): Promise<void> {
  try {
    const { error } = await resend.emails.send({
      from: EMAIL_FROM,
      to: application.email,
      subject: 'An update on your Alpha Gemstone Dropship application',
      html: dropshipApplicationRejectedEmailHtml({
        fullName: application.fullName,
        reason: application.rejectionReason,
      }),
    });
    if (error) console.error('[dropshipApplicationRejectedEmail] Resend error:', error);
  } catch (err) {
    console.error('[dropshipApplicationRejectedEmail] Failed:', err);
  }
}

async function sendOrderPaidEmail(
  order: IDropshipOrder,
  application: IDropshipApplication
): Promise<void> {
  try {
    const { error } = await resend.emails.send({
      from: EMAIL_FROM,
      to: application.email,
      subject: `Payment received — ${order.customerName}'s order`,
      html: dropshipOrderConfirmationEmailHtml({
        sellerName: application.fullName,
        productName: order.productName,
        quantity: order.quantity,
        amount: order.amount,
        customerName: order.customerName,
        portalUrl: portalUrlFor(application),
      }),
    });
    if (error) console.error('[sendOrderPaidEmail] Resend error:', error);
  } catch (err) {
    console.error('[sendOrderPaidEmail] Failed:', err);
  }
}

async function sendPaymentFailedEmail(
  order: IDropshipOrder,
  application: IDropshipApplication
): Promise<void> {
  try {
    const { error } = await resend.emails.send({
      from: EMAIL_FROM,
      to: application.email,
      subject: `Payment not completed — ${order.productName}`,
      html: dropshipOrderPaymentFailedEmailHtml({
        sellerName: application.fullName,
        productName: order.productName,
        portalUrl: portalUrlFor(application),
      }),
    });
    if (error) console.error('[sendPaymentFailedEmail] Resend error:', error);
  } catch (err) {
    console.error('[sendPaymentFailedEmail] Failed:', err);
  }
}

async function sendAdminNewOrderEmail(order: IDropshipOrder): Promise<void> {
  try {
    if (ADMIN_NOTIFICATION_EMAILS.length === 0) return;
    const { error } = await resend.emails.send({
      from: EMAIL_FROM,
      to: ADMIN_NOTIFICATION_EMAILS,
      subject: `Paid Dropship Order — ${order.customerName}`,
      html: adminNewDropshipOrderEmailHtml({
        orderId: order._id.toString(),
        sellerBusinessName: order.sellerBusinessName,
        sellerEmail: order.sellerEmail,
        productName: order.productName,
        quantity: order.quantity,
        amount: order.amount,
        customerName: order.customerName,
        city: order.city,
        country: order.country,
      }),
    });
    if (error) console.error('[adminNewDropshipOrderEmail] Resend error:', error);
  } catch (err) {
    console.error('[adminNewDropshipOrderEmail] Failed:', err);
  }
}
