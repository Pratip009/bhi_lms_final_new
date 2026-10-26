import { NextRequest } from 'next/server';
import { z } from 'zod';
import { successResponse, errorResponse } from '@/lib/api-response';
import { rateLimit, rateLimitResponse } from '@/lib/rate-limit';
import {
  submitDropshipOrder,
  DropshipError,
  DROPSHIP_MAX_QUANTITY,
} from '@/services/dropship.service';

const opt = (max: number) => z.string().trim().max(max).optional();

// NOTE: no price or shipping amount is accepted from the client. The product
// price is read from the database and the shipping price comes from the
// server-signed `shippingQuote` (see src/lib/dropshipQuote.ts).
const schema = z.object({
  productId: z.string().regex(/^[a-f0-9]{24}$/i, 'Please select a product'),
  quantity: z.number().int().min(1).max(DROPSHIP_MAX_QUANTITY).optional(),
  specifications: opt(500),
  customerName: z.string().trim().min(2, "Customer's name is required").max(120),
  customerEmail: z.string().trim().email('Enter a valid email or leave it blank').max(200).optional().or(z.literal('')),
  customerPhone: opt(40),
  addressLine1: z.string().trim().min(2, 'Shipping address is required').max(200),
  addressLine2: opt(200),
  city: z.string().trim().min(1, 'City is required').max(100),
  state: z.string().trim().length(2, 'Choose a state / province'),
  postalCode: z.string().trim().min(3, 'Postal code is required').max(20),
  country: z.enum(['US', 'CA']).optional(),
  shippingQuote: z.string().min(10, 'Please choose a shipping method').max(4000),
  specialInstructions: opt(1000),
  clientRequestId: z.string().regex(/^[a-zA-Z0-9-]{8,64}$/).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;

    const rate = await rateLimit(req, {
      id: 'dropship-order-submit',
      limit: 30,
      windowSec: 3600,
      extraKey: token,
      scope: 'key',
    });
    if (!rate.success) return rateLimitResponse(rate);

    const body = await req.json().catch(() => null);
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(
        'Please check the highlighted fields.',
        422,
        parsed.error.flatten().fieldErrors
      );
    }

    const order = await submitDropshipOrder(token, parsed.data);
    return successResponse(
      { orderId: order._id, status: order.status, amount: order.amount },
      201
    );
  } catch (err) {
    if (err instanceof DropshipError) return errorResponse(err.message, err.status);
    console.error('POST /api/dropship/portal/[token]/orders error:', err);
    return errorResponse('Failed to submit order', 500);
  }
}
