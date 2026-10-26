/**
 * POST /api/webhooks/shipstation?secret=...
 *
 * Registers as a ShipStation "Tracking Updated" webhook target
 * (Account Settings → Integration Partners → Webhooks → Add a Webhook,
 * or POST /v1/environments/webhooks — event: TRACK).
 *
 * This is what closes the loop that was missing before: without this route,
 * nothing in the app ever finds out a package was delivered, so orders sat
 * at "shipped" forever and customers/admins never got a "delivered" signal.
 *
 * ShipStation does not POST the full tracking payload — it POSTs a small
 * envelope with a `resource_url` you must GET (with your API key) to fetch
 * the actual data. We deliberately don't trust the webhook body for the
 * "is it delivered" decision — we just use it as a trigger, then re-fetch
 * canonical tracking info via trackShipEnginePackage() (the same function
 * the UI uses), and only update the order status if that live lookup
 * confirms `deliveredAt`.
 *
 * Auth: ShipStation's UI-configured webhooks can't attach custom headers
 * reliably, so we authenticate via a `secret` query param instead. Set
 * SHIPSTATION_WEBHOOK_SECRET in your env, and register the webhook target
 * URL as: https://yourdomain.com/api/webhooks/shipstation?secret=YOUR_SECRET
 *
 * We always return 200 for anything that isn't an auth failure — ShipStation
 * retries on non-2xx responses, and retrying "we didn't recognize this
 * payload" or "this label isn't in our DB" would just waste calls.
 */

import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { trackShipEnginePackage } from '@/services/shipengine.service';
import { applyDeliveryStatus, getOrderByLabelId } from '@/services/order.service';
import DropshipOrder from '@/models/DropshipOrder';
import { markDropshipOrderDelivered } from '@/services/dropship.service';

/**
 * ShipStation's webhook envelope looks like:
 *   { "resource_url": "https://api.shipstation.com/v2/labels/se-123/track",
 *     "resource_type": "TRACK" }
 * Pull the label_id back out of that URL so we can re-fetch tracking with
 * the same function the rest of the app already uses.
 */
function extractLabelId(resourceUrl: string | undefined): string | null {
  if (!resourceUrl) return null;
  const match = resourceUrl.match(/\/labels\/([^/]+)\/track/i);
  return match?.[1] ?? null;
}

export async function POST(req: NextRequest) {
  const expectedSecret = process.env.SHIPSTATION_WEBHOOK_SECRET;
  const providedSecret = req.nextUrl.searchParams.get('secret');

  if (!expectedSecret) {
    console.error('[webhooks/shipstation] SHIPSTATION_WEBHOOK_SECRET is not set — rejecting all webhook calls.');
    return NextResponse.json({ received: false, message: 'Webhook not configured' }, { status: 401 });
  }
  if (providedSecret !== expectedSecret) {
    return NextResponse.json({ received: false, message: 'Invalid secret' }, { status: 401 });
  }

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    // Some webhook test pings send an empty body — that's fine, just ack it.
    return NextResponse.json({ received: true });
  }

  // Only the tracking-update event matters for delivery sync. Ignore others
  // (order-created, label-created, etc) rather than erroring on them.
  const resourceType = body?.resource_type ?? body?.resourceType;
  if (resourceType && resourceType !== 'TRACK') {
    return NextResponse.json({ received: true, skipped: resourceType });
  }

  const labelId =
    body?.data?.label_id ??
    extractLabelId(body?.resource_url ?? body?.resourceUrl);

  if (!labelId) {
    console.warn('[webhooks/shipstation] Could not extract label_id from payload:', JSON.stringify(body));
    return NextResponse.json({ received: true, skipped: 'no_label_id' });
  }

  try {
    await connectDB();

    const order = await getOrderByLabelId(labelId);
    if (!order) {
      // Dropship orders keep their labels on DropshipOrder, not Order.
      const dropship = await DropshipOrder.findOne({ labelId }).select('_id').lean() as { _id: any } | null;
      if (dropship) {
        const tracking = await trackShipEnginePackage(labelId);
        const delivered = tracking.deliveredAt
          ? await markDropshipOrderDelivered(dropship._id.toString())
          : false;
        return NextResponse.json({ received: true, dropshipOrderId: dropship._id.toString(), delivered });
      }
      // Not necessarily a bug — could be a label from a test/other account.
      console.warn(`[webhooks/shipstation] No order found for labelId ${labelId}`);
      return NextResponse.json({ received: true, skipped: 'no_matching_order' });
    }

    // Re-fetch canonical tracking data rather than trusting the webhook body.
    const tracking = await trackShipEnginePackage(labelId);

    const updated = await applyDeliveryStatus(order._id.toString(), tracking.deliveredAt ?? null);

    return NextResponse.json({
      received: true,
      orderId: order._id.toString(),
      delivered: Boolean(updated),
    });
  } catch (err: any) {
    // Log but still return 200 — a transient DB/ShipStation hiccup shouldn't
    // cause ShipStation to keep retrying the same event indefinitely. The
    // hourly cron fallback (/api/cron/sync-deliveries) will catch anything
    // missed here.
    console.error('[webhooks/shipstation] Failed to process webhook:', err);
    return NextResponse.json({ received: true, error: err.message ?? 'processing_failed' });
  }
}