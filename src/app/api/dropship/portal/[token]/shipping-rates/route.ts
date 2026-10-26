import { NextRequest } from 'next/server';
import { z } from 'zod';
import { successResponse, errorResponse } from '@/lib/api-response';
import { rateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { getDropshipShippingRates, DropshipError } from '@/services/dropship.service';

const schema = z.object({
  street1: z.string().trim().min(2, 'Street address is required').max(200),
  street2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(1, 'City is required').max(100),
  state: z.string().trim().length(2, 'Choose a state / province'),
  postalCode: z.string().trim().min(3, 'Postal code is required').max(20),
  country: z.enum(['US', 'CA']).optional(),
});

/**
 * POST /api/dropship/portal/[token]/shipping-rates
 * Body: destination address
 * → Live ShipEngine rates (same origin/package defaults as normal customer
 *   checkout), each including the fee-inclusive cost the seller will pay and
 *   a signed quoteToken that the order submit requires (price can't be edited).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;

    const rate = await rateLimit(req, {
      id: 'dropship-shipping-rates',
      limit: 60,
      windowSec: 3600,
      extraKey: token,
      scope: 'key',
    });
    if (!rate.success) return rateLimitResponse(rate);

    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return errorResponse('Invalid address', 422, parsed.error.flatten().fieldErrors);
    }

    const rates = await getDropshipShippingRates(token, parsed.data);
    return successResponse({ rates });
  } catch (err) {
    if (err instanceof DropshipError) return errorResponse(err.message, err.status);
    console.error('POST /api/dropship/portal/[token]/shipping-rates error:', err);
    return errorResponse(
      'We couldn’t get shipping rates for this address. Please double-check the street, city, state and postal code.',
      500
    );
  }
}
