import { NextRequest } from 'next/server';
import { z } from 'zod';
import { successResponse, errorResponse } from '@/lib/api-response';
import { rateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { captureDropshipPayment, DropshipError } from '@/services/dropship.service';

const schema = z.object({ paypalOrderId: z.string().min(1).max(64) });

/**
 * POST /api/dropship/portal/[token]/orders/[orderId]/pay/capture
 * Body: { paypalOrderId }
 * → Captures the PayPal payment the seller just approved and moves the order
 *   into fulfillment. (This route previously re-ran the *initiate* step by
 *   mistake, so payments were never actually captured.)
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string; orderId: string }> }
) {
  try {
    const { token, orderId } = await params;

    const rate = await rateLimit(req, {
      id: 'dropship-pay-capture',
      limit: 30,
      windowSec: 3600,
      extraKey: token,
      scope: 'key',
    });
    if (!rate.success) return rateLimitResponse(rate);

    const body = await req.json().catch(() => ({}));
    const parsed = schema.safeParse(body);
    if (!parsed.success) return errorResponse('Missing PayPal order reference.', 422);

    const order = await captureDropshipPayment(token, orderId, parsed.data.paypalOrderId);
    return successResponse({
      orderId: order._id,
      status: order.status,
      paymentStatus: order.paymentStatus,
      trackingNumber: order.trackingNumber ?? null,
    });
  } catch (err) {
    if (err instanceof DropshipError) return errorResponse(err.message, err.status);
    console.error('POST /api/dropship/portal/[token]/orders/[orderId]/pay/capture error:', err);
    return errorResponse(
      'We could not confirm the payment. Please refresh the page before trying again — if the order shows “Paid”, do not pay again.',
      500
    );
  }
}
