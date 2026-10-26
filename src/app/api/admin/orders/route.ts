import { connectDB } from '@/lib/db';
import { getUnifiedOrders, OrderSource } from '@/services/adminOrders.service';
import { withAdmin, AuthenticatedRequest } from '@/middleware/auth.middleware';
import { errorResponse } from '@/lib/api-response';

/**
 * GET /api/admin/orders?page=&limit=&status=&source=store|dropship&q=&attention=1
 *
 * Store orders and dropship orders in ONE list (newest first). Every
 * dropship row has `source: "dropship"` so the page can label it.
 */
export const GET = withAdmin(async (req: AuthenticatedRequest) => {
  try {
    await connectDB();
    const { searchParams } = new URL(req.url);
    const page = Number(searchParams.get('page') || 1);
    const limit = Number(searchParams.get('limit') || 20);
    const status = searchParams.get('status') || undefined;
    const sourceRaw = searchParams.get('source');
    const source: OrderSource | '' =
      sourceRaw === 'store' || sourceRaw === 'dropship' ? sourceRaw : '';
    const q = searchParams.get('q') || undefined;
    const attention = searchParams.get('attention') === '1';

    const result = await getUnifiedOrders({ page, limit, status, source, q, attention });

    return Response.json({
      success: true,
      data: result.orders,
      pagination: {
        total: result.total,
        page: result.page,
        limit: result.limit,
        totalPages: result.totalPages,
      },
      counts: result.counts,
    });
  } catch (err) {
    console.error('[getAllOrders]', err);
    return errorResponse('Failed to fetch orders', 500);
  }
});
