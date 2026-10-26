import mongoose, { PipelineStage } from 'mongoose';
import Order from '@/models/Order';
import DropshipOrder from '@/models/DropshipOrder';
import User from '@/models/User';
import '@/lib/registerModels';
import { escapeRegex } from '@/lib/search';

/**
 * One list for the admin Orders tab: normal store orders AND dropship
 * orders, newest first, paginated together, with one search box.
 *
 * Dropship orders are reshaped into the same fields the Orders page already
 * renders (user / items / shippingAddress / totals) plus `source: 'dropship'`
 * and a `dropship` block, so the page shows them in the same table with a
 * clear "Dropship" label. Mapping:
 *   user            → the SELLER (they pay Alpha — "Bill to")
 *   shippingAddress → the seller's END CUSTOMER (where the parcel goes)
 *   status          → pending_payment is shown as "pending"
 */

export type OrderSource = 'store' | 'dropship';

// DropshipOrder status  →  Orders-page status
const DROPSHIP_TO_UNIFIED: Record<string, string> = {
  pending_payment: 'pending',
  processing: 'processing',
  shipped: 'shipped',
  delivered: 'delivered',
  cancelled: 'cancelled',
};
// Orders-page status  →  DropshipOrder status (only those that exist)
export const UNIFIED_TO_DROPSHIP: Record<string, string> = {
  pending: 'pending_payment',
  processing: 'processing',
  shipped: 'shipped',
  delivered: 'delivered',
  cancelled: 'cancelled',
};
export const DROPSHIP_ALLOWED_STATUSES = Object.keys(UNIFIED_TO_DROPSHIP);

/** Aggregation stages that turn a DropshipOrder into the unified shape. */
function dropshipShapeStages(): PipelineStage[] {
  return [
    {
      $addFields: {
        source: 'dropship',
        status: {
          $switch: {
            branches: Object.entries(DROPSHIP_TO_UNIFIED).map(([from, to]) => ({
              case: { $eq: ['$status', from] },
              then: to,
            })),
            default: '$status',
          },
        },
        user: {
          _id: '$application',
          name: { $ifNull: ['$sellerBusinessName', '$sellerEmail'] },
          email: '$sellerEmail',
        },
        items: [
          {
            product: '$product',
            name: '$productName',
            price: '$unitPrice',
            quantity: '$quantity',
            image: '$productImage',
          },
        ],
        shippingAddress: {
          fullName: '$customerName',
          addressLine1: '$addressLine1',
          addressLine2: '$addressLine2',
          city: '$city',
          state: { $ifNull: ['$state', ''] },
          postalCode: '$postalCode',
          country: '$country',
          phone: '$customerPhone',
        },
        subtotal: '$productAmount',
        tax: { $literal: 0 },
        totalAmount: '$amount',
        paymentMethod: { $literal: 'paypal' },
        dropship: {
          applicationId: '$application',
          sellerName: '$sellerBusinessName',
          sellerEmail: '$sellerEmail',
          customerEmail: '$customerEmail',
          customerPhone: '$customerPhone',
          specifications: '$specifications',
          specialInstructions: '$specialInstructions',
          adminNotes: '$adminNotes',
          needsAttention: { $ifNull: ['$needsAttention', false] },
          attentionReason: '$attentionReason',
          rawStatus: '$status',
        },
      },
    },
    {
      $project: {
        productName: 0, productImage: 0, unitPrice: 0, quantity: 0, product: 0,
        productAmount: 0, amount: 0, customerName: 0, customerEmail: 0, customerPhone: 0,
        addressLine1: 0, addressLine2: 0, city: 0, state: 0, postalCode: 0, country: 0,
        sellerBusinessName: 0, sellerEmail: 0, application: 0, specifications: 0,
        specialInstructions: 0, adminNotes: 0, clientRequestId: 0, captureLockUntil: 0,
        needsAttention: 0, attentionReason: 0,
      },
    },
  ];
}

function storeShapeStages(): PipelineStage[] {
  return [
    {
      $lookup: {
        from: User.collection.name,
        localField: 'user',
        foreignField: '_id',
        as: '_user',
      },
    },
    {
      $addFields: {
        source: 'store',
        user: {
          $let: {
            vars: { u: { $arrayElemAt: ['$_user', 0] } },
            in: { _id: '$$u._id', name: '$$u.name', email: '$$u.email' },
          },
        },
      },
    },
    { $project: { _user: 0 } },
  ];
}

export interface UnifiedOrderQuery {
  page?: number;
  limit?: number;
  status?: string;
  source?: OrderSource | '';
  q?: string;
  attention?: boolean;
}

export async function getUnifiedOrders(params: UnifiedOrderQuery) {
  const page = Math.max(1, Math.floor(params.page || 1));
  const limit = Math.min(100, Math.max(1, Math.floor(params.limit || 20)));
  const status = params.status || '';
  const source = params.source || '';

  const storeMatch: Record<string, unknown> = {};
  if (status) storeMatch.status = status;

  const dropshipMatch: Record<string, unknown> = {};
  if (status) {
    // Statuses that don't exist for dropship ("paid", "refunded") match nothing.
    dropshipMatch.status = UNIFIED_TO_DROPSHIP[status] ?? '__none__';
  }
  if (params.attention) {
    dropshipMatch.needsAttention = true;
  }

  const includeStore = source !== 'dropship' && !params.attention;
  const includeDropship = source !== 'store';

  const q = (params.q || '').trim().slice(0, 100);
  const searchStage: PipelineStage[] = [];
  if (q) {
    const rx = new RegExp(escapeRegex(q.replace(/^#/, '')), 'i');
    searchStage.push(
      { $addFields: { _idStr: { $toString: '$_id' } } },
      {
        $match: {
          $or: [
            { _idStr: rx },
            { 'user.name': rx },
            { 'user.email': rx },
            { 'shippingAddress.fullName': rx },
            { 'items.name': rx },
            { trackingNumber: rx },
          ],
        },
      },
      { $project: { _idStr: 0 } }
    );
  }

  const dropshipColl = DropshipOrder.collection.name;
  const dropshipPipeline = [{ $match: dropshipMatch }, ...dropshipShapeStages()];

  let pipeline: PipelineStage[];
  let baseModel: mongoose.Model<any>;
  if (includeStore) {
    baseModel = Order;
    pipeline = [{ $match: storeMatch }, ...storeShapeStages()];
    if (includeDropship) {
      pipeline.push({ $unionWith: { coll: dropshipColl, pipeline: dropshipPipeline as any } });
    }
  } else {
    baseModel = DropshipOrder;
    pipeline = [...dropshipPipeline];
  }

  pipeline.push(...searchStage, {
    $facet: {
      data: [{ $sort: { createdAt: -1, _id: -1 } }, { $skip: (page - 1) * limit }, { $limit: limit }],
      total: [{ $count: 'n' }],
    },
  });

  const [[result], counts] = await Promise.all([
    baseModel.aggregate(pipeline).allowDiskUse(true),
    getOrderSourceCounts(),
  ]);

  const total: number = result?.total?.[0]?.n ?? 0;
  return {
    orders: result?.data ?? [],
    total,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(total / limit)),
    counts,
  };
}

export async function getOrderSourceCounts() {
  const [store, dropship, dropshipAwaitingPayment, dropshipToShip, dropshipAttention] =
    await Promise.all([
      Order.estimatedDocumentCount(),
      DropshipOrder.estimatedDocumentCount(),
      DropshipOrder.countDocuments({ status: 'pending_payment' }),
      DropshipOrder.countDocuments({ status: 'processing', paymentStatus: 'completed' }),
      DropshipOrder.countDocuments({ needsAttention: true }),
    ]);
  return {
    all: store + dropship,
    store,
    dropship,
    dropshipAwaitingPayment,
    dropshipToShip,
    dropshipAttention,
  };
}

/** A single dropship order in the unified shape (used after admin edits so the row updates in place). */
export async function getUnifiedDropshipOrder(id: string) {
  if (!mongoose.isValidObjectId(id)) return null;
  const [row] = await DropshipOrder.aggregate([
    { $match: { _id: new mongoose.Types.ObjectId(id) } },
    ...dropshipShapeStages(),
  ]);
  return row ?? null;
}
