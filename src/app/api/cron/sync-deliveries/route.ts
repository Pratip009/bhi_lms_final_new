/**
 * GET /api/cron/sync-deliveries
 *
 * Fallback safety net for the ShipStation webhook (/api/webhooks/shipstation).
 * Webhooks can be missed (endpoint down during a deploy, ShipStation retry
 * budget exhausted, webhook never configured yet, etc), so this route walks
 * every order that's "processing"/"shipped" with a ShipStation label and
 * polls live tracking for each one. Anything the carrier reports as
 * delivered gets flipped to `delivered` (and the customer gets the
 * "delivered" email) via the same applyDeliveryStatus() the webhook uses,
 * so it's safe to run both — neither will double-send.
 *
 * Wire this up to run on a schedule (Vercel Cron shown below; any external
 * scheduler that can hit a URL works too — cron-job.org, GitHub Actions, etc).
 *
 * vercel.json:
 *   {
 *     "crons": [{ "path": "/api/cron/sync-deliveries", "schedule": "0 * * * *" }]
 *   }
 *
 * Auth: Vercel Cron automatically sends `Authorization: Bearer $CRON_SECRET`
 * when CRON_SECRET is set in your project's env vars — this route checks for
 * that. If you're using an external scheduler instead, call this URL with
 * that same header (or `?secret=...`, also supported below).
 */

import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { trackShipEnginePackage } from '@/services/shipengine.service';
import { applyDeliveryStatus, getOrdersAwaitingDeliverySync } from '@/services/order.service';
import {
  getDropshipOrdersAwaitingDeliverySync,
  markDropshipOrderDelivered,
} from '@/services/dropship.service';

function isAuthorized(req: NextRequest): boolean {
  // Was a hard-coded string committed to the repo, which let anyone trigger
  // this job and meant Vercel Cron (which sends $CRON_SECRET) was rejected.
  const expected = process.env.CRON_SECRET;
  if (!expected) return false; // fail closed — don't run an unprotected cron

  const authHeader = req.headers.get('authorization');
  if (authHeader === `Bearer ${expected}`) return true;

  const querySecret = req.nextUrl.searchParams.get('secret');
  return querySecret === expected;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
  }

  await connectDB();

  const candidates = await getOrdersAwaitingDeliverySync();

  let checked = 0;
  let delivered = 0;
  const errors: Array<{ orderId: string; message: string }> = [];

  // Sequential on purpose — ShipStation rate-limits tracking calls, and
  // trackShipEnginePackage already retries on 429s internally. A batch of
  // parallel requests here would just make those retries more likely.
  for (const order of candidates) {
    checked += 1;
    try {
      const tracking = await trackShipEnginePackage(order.labelId);
      if (tracking.deliveredAt) {
        const updated = await applyDeliveryStatus(order._id.toString(), tracking.deliveredAt);
        if (updated) delivered += 1;
      }
    } catch (err: any) {
      errors.push({ orderId: order._id.toString(), message: err?.message ?? 'unknown error' });
    }
  }

  // Dropship orders — same carrier check, stored on DropshipOrder.
  const dropshipCandidates = await getDropshipOrdersAwaitingDeliverySync();
  for (const order of dropshipCandidates) {
    checked += 1;
    try {
      const tracking = await trackShipEnginePackage(order.labelId);
      if (tracking.deliveredAt && (await markDropshipOrderDelivered(order._id.toString()))) {
        delivered += 1;
      }
    } catch (err: any) {
      errors.push({ orderId: `dropship:${order._id.toString()}`, message: err?.message ?? 'unknown error' });
    }
  }

  const summary = { checked, delivered, errorCount: errors.length, errors };
  if (errors.length > 0) {
    console.warn('[cron/sync-deliveries] Completed with errors:', summary);
  }

  return NextResponse.json({ success: true, data: summary });
}