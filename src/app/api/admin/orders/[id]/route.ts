import { connectDB } from '@/lib/db';
import Order, { IOrder } from '@/models/Order';
import { withAdmin, AuthenticatedRequest } from '@/middleware/auth.middleware';
import { successResponse, errorResponse } from '@/lib/api-response';
import { buildTrackingUrl } from '@/models/ORDER_SHIPPING_FIELDS';
import { Resend } from 'resend';
import { orderShippedEmailHtml } from '@/lib/email-templates';
import mongoose from 'mongoose';
import DropshipOrder from '@/models/DropshipOrder';
import {
  adminUpdateOrder as adminUpdateDropshipOrder,
  adminDeleteOrder as adminDeleteDropshipOrder,
  DropshipError,
} from '@/services/dropship.service';
import {
  getUnifiedDropshipOrder,
  UNIFIED_TO_DROPSHIP,
  DROPSHIP_ALLOWED_STATUSES,
} from '@/services/adminOrders.service';

// The Orders tab lists store AND dropship orders together, so every action
// here first checks the normal Order collection and, if the id isn't there,
// falls through to the dropship order with the same id. Ids are Mongo
// ObjectIds, so they can never collide between the two collections.
async function isDropshipOrder(id: string): Promise<boolean> {
  if (!mongoose.isValidObjectId(id)) return false;
  if (await Order.exists({ _id: id })) return false;
  return Boolean(await DropshipOrder.exists({ _id: id }));
}

async function updateDropship(id: string, body: any) {
  const { status, trackingNumber, shippingCarrier, trackingUrl, adminNotes, needsAttention } = body ?? {};
  if (status && !DROPSHIP_ALLOWED_STATUSES.includes(status)) {
    return errorResponse(
      `Dropship orders can only be: Pending (awaiting payment), Processing, Shipped, Delivered or Cancelled.`,
      400
    );
  }
  try {
    await adminUpdateDropshipOrder(id, {
      status: status ? (UNIFIED_TO_DROPSHIP[status] as any) : undefined,
      trackingNumber: typeof trackingNumber === 'string' ? trackingNumber : undefined,
      trackingUrl: typeof trackingUrl === 'string' ? trackingUrl : undefined,
      shippingCarrier: typeof shippingCarrier === 'string' ? shippingCarrier : undefined,
      adminNotes: typeof adminNotes === 'string' ? adminNotes : undefined,
      needsAttention: needsAttention === false ? false : undefined,
    });
  } catch (err) {
    if (err instanceof DropshipError) return errorResponse(err.message, err.status);
    throw err;
  }
  return successResponse(await getUnifiedDropshipOrder(id));
}

const resend = new Resend(process.env.RESEND_API_KEY);
const EMAIL_FROM = process.env.EMAIL_FROM || 'onboarding@resend.dev';

export const PUT = withAdmin(async (req: AuthenticatedRequest, context: { params: Promise<{ id: string }> }) => {
  try {
    await connectDB();
    const { id } = await context.params;
    const body = await req.json();
    if (await isDropshipOrder(id)) return updateDropship(id, body);
    const { status, trackingNumber, shippingCarrier, trackingUrl } = body;

    const validStatuses = ['pending', 'paid', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded'];
    if (status && !validStatuses.includes(status)) {
      return errorResponse(`Invalid status. Must be one of: ${validStatuses.join(', ')}`, 400);
    }

    const $set: Record<string, unknown> = {};
    if (status) $set.status = status;
    if (trackingNumber !== undefined) $set.trackingNumber = trackingNumber;
    if (shippingCarrier !== undefined) $set.shippingCarrier = shippingCarrier;

    if (trackingUrl !== undefined) {
      // Admin explicitly provided a URL — respect it as-is.
      $set.trackingUrl = trackingUrl;
    } else if (trackingNumber) {
      // No explicit URL, but a tracking number was (re)set — try to build one
      // from the carrier so the customer still gets a "track on carrier site"
      // link even for manually-entered (non-ShipStation) shipments.
      $set.trackingUrl = buildTrackingUrl(shippingCarrier ?? null, trackingNumber);
    }

    if (Object.keys($set).length === 0) {
      return errorResponse('No fields to update', 400);
    }

    const order = await Order.findByIdAndUpdate(
      id,
      { $set },
      { new: true }
    ).populate('user', 'name email').lean() as (IOrder & { user: { name: string; email: string } }) | null;

    if (!order) return errorResponse('Order not found', 404);

    // Send shipped notification email when admin marks order as shipped
    if (status === 'shipped') {
const tracking = trackingNumber ?? order.trackingNumber;
      if (tracking) {
        void resend.emails.send({
          from: EMAIL_FROM,
          to: order.user.email,
          subject: `Your Order Has Shipped — #${order._id.toString().slice(-8).toUpperCase()}`,
          html: orderShippedEmailHtml({
            orderId: order._id.toString(),
            customerName: order.user.name,
            trackingNumber: tracking,
            trackingUrl: (trackingUrl ?? order.trackingUrl) || undefined,
            shippingCarrier: (shippingCarrier ?? order.shippingCarrier) || undefined,
            estimatedDelivery: order.shippingEstimatedDelivery ?? undefined,
          }),
        });
      }
    }

    return successResponse(order);
  } catch (err) {
    console.error('[updateOrder]', err);
    return errorResponse('Failed to update order', 500);
  }
});

export const GET = withAdmin(async (req: AuthenticatedRequest, context: { params: Promise<{ id: string }> }) => {
  try {
    await connectDB();
    const { id } = await context.params;
    if (await isDropshipOrder(id)) return successResponse(await getUnifiedDropshipOrder(id));
    const order = await Order.findById(id).populate('user', 'name email').lean();
    if (!order) return errorResponse('Order not found', 404);
    return successResponse(order);
  } catch (err) {
    console.error('[getOrder]', err);
    return errorResponse('Failed to fetch order', 500);
  }
});
export const DELETE = withAdmin(async (req: AuthenticatedRequest, context: { params: Promise<{ id: string }> }) => {
  try {
    await connectDB();
    const { id } = await context.params;
    if (await isDropshipOrder(id)) {
      // Also puts any reserved-but-unpaid stock back on the shelf.
      await adminDeleteDropshipOrder(id);
      return successResponse({ _id: id, deleted: true, source: 'dropship' });
    }
    const order = await Order.findByIdAndDelete(id).lean();
    if (!order) return errorResponse('Order not found', 404);
    return successResponse({ _id: id, deleted: true });
  } catch (err) {
    console.error('[deleteOrder]', err);
    return errorResponse('Failed to delete order', 500);
  }
});