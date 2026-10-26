import { NextRequest } from 'next/server';
import { successResponse, errorResponse } from '@/lib/api-response';
import { sellerCancelOrder, DropshipError } from '@/services/dropship.service';

/**
 * POST /api/dropship/portal/[token]/orders/[orderId]/cancel
 * → Seller cancels one of their own UNPAID orders; reserved stock is released.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string; orderId: string }> }
) {
  try {
    const { token, orderId } = await params;
    const order = await sellerCancelOrder(token, orderId);
    return successResponse({ orderId: order._id, status: order.status });
  } catch (err) {
    if (err instanceof DropshipError) return errorResponse(err.message, err.status);
    console.error('POST /api/dropship/portal/[token]/orders/[orderId]/cancel error:', err);
    return errorResponse('Failed to cancel order', 500);
  }
}
