/**
 * POST /api/admin/orders/:id/purchase-label
 * Admin-only. Purchases a ShipEngine label for an order using its stored rateId.
 * Optionally accepts { "rateId": "..." } in the body to override.
 *
 * On success:
 *  - Saves labelId, labelUrl, trackingNumber, shippedAt to the order
 *  - Sets order status → "shipped"
 *  - Sends "Your order has shipped" email to the customer
 */

import { NextRequest } from 'next/server';
import { connectDB } from '@/lib/db';
import { apiError, apiSuccess } from '@/lib/api-response';
import { withAdmin } from '@/middleware/auth.middleware';
import { purchaseAndSaveLabel } from '@/services/order.service';
import mongoose from 'mongoose';
import Order from '@/models/Order';
import DropshipOrder from '@/models/DropshipOrder';
import { adminPurchaseDropshipLabel, DropshipError } from '@/services/dropship.service';
import { getUnifiedDropshipOrder } from '@/services/adminOrders.service';

async function handler(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    // Next.js 15: params is a Promise — must be awaited
    const { id } = await context.params;

    await connectDB();

    // Dropship orders show in the same Orders tab — same button, same result.
    if (
      mongoose.isValidObjectId(id) &&
      !(await Order.exists({ _id: id })) &&
      (await DropshipOrder.exists({ _id: id }))
    ) {
      try {
        await adminPurchaseDropshipLabel(id);
      } catch (e) {
        if (e instanceof DropshipError) return apiError(e.message, e.status);
        throw e;
      }
      return apiSuccess({ order: await getUnifiedDropshipOrder(id) });
    }

    const body = await req.json().catch(() => ({}));
    const rateIdOverride: string | undefined = body?.rateId ?? undefined;

    // triggeredByAdmin=true → status becomes "shipped" + sends shipped email
    const order = await purchaseAndSaveLabel(id, rateIdOverride, true);
    return apiSuccess({ order });
  } catch (err: any) {
    console.error('[admin/orders/purchase-label]', err);
    return apiError(err.message ?? 'Failed to purchase label', 500);
  }
}

export const POST = withAdmin(handler);