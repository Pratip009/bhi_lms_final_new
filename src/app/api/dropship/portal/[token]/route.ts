import { NextRequest } from 'next/server';
import { successResponse, errorResponse } from '@/lib/api-response';
import { listOrdersForToken, DROPSHIP_MAX_QUANTITY } from '@/services/dropship.service';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    const result = await listOrdersForToken(token);
    if (!result) return errorResponse('Portal link not found', 404);

    const { application, orders } = result;
    const approvedAndActive = application.status === 'approved' && application.active !== false;
    return successResponse({
      application: {
        fullName: application.fullName,
        businessName: application.businessName,
        email: application.email,
        status: application.status,
        // Was never sent before, so a deactivated seller still saw the full
        // portal (every action then failed with a 403).
        active: application.active !== false,
        createdAt: application.createdAt,
      },
      // Order history only for sellers who can actually use the portal.
      orders: approvedAndActive ? orders : [],
      limits: { maxQuantity: DROPSHIP_MAX_QUANTITY },
    });
  } catch (err) {
    console.error('GET /api/dropship/portal/[token] error:', err);
    return errorResponse('Failed to load portal', 500);
  }
}
