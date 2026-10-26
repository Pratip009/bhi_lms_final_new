import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { releaseExpiredPendingOrders } from '@/services/order.service';
import { releaseStaleDropshipOrders } from '@/services/dropship.service';

// Same auth pattern as src/app/api/cron/sync-deliveries/route.ts:
// Authorization: Bearer <CRON_SECRET>  OR  ?secret=<CRON_SECRET>
function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const bearer = req.headers.get('authorization');
  if (bearer === `Bearer ${secret}`) return true;
  const { searchParams } = new URL(req.url);
  return searchParams.get('secret') === secret;
}

/**
 * Backstop for abandoned checkouts: any order that's been sitting 'pending'
 * (created, stock reserved, never paid) for more than 30 minutes gets
 * cancelled and its stock released back to inventory. Most abandoned orders
 * are already cleaned up immediately by the checkout UI itself (see
 * cancelOwnPendingOrder, called when the customer goes back to change their
 * shipping method), but this catches the case where someone just closes the
 * tab mid-checkout and never comes back.
 */
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  await connectDB();

  try {
    const released = await releaseExpiredPendingOrders(30);
    // Unpaid dropship orders: stock back after 60 min, auto-cancel after 7 days.
    const dropship = await releaseStaleDropshipOrders().catch((err) => {
      console.error('release-stale-orders: dropship sweep failed', err);
      return { released: 0, cancelled: 0 };
    });
    return NextResponse.json({
      success: true,
      data: {
        releasedCount: released,
        dropshipStockReleased: dropship.released,
        dropshipCancelled: dropship.cancelled,
      },
    });
  } catch (err) {
    console.error('release-stale-orders: failed', err);
    return NextResponse.json({ success: false, error: 'Failed to release stale orders' }, { status: 500 });
  }
}
