import { NextRequest } from 'next/server';
import { successResponse, errorResponse } from '@/lib/api-response';
import { rateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { initiateDropshipPayment, DropshipError } from '@/services/dropship.service';

/**
 * POST /api/dropship/portal/[token]/orders/[orderId]/pay
 * → Creates a PayPal order for this dropship order's amount, returns the
 *   PayPal order id for the PayPalButtons createOrder callback.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string; orderId: string }> }
) {
  try {
    const { token, orderId } = await params;

    const rate = await rateLimit(req, {
      id: 'dropship-pay-init',
      limit: 40,
      windowSec: 3600,
      extraKey: token,
      scope: 'key',
    });
    if (!rate.success) return rateLimitResponse(rate);

    const result = await initiateDropshipPayment(token, orderId);
    return successResponse(result);
  } catch (err) {
    if (err instanceof DropshipError) return errorResponse(err.message, err.status);
    console.error('POST /api/dropship/portal/[token]/orders/[orderId]/pay error:', err);
    return errorResponse('Failed to start payment', 500);
  }
}
