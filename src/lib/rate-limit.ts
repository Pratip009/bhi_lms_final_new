import "server-only";
import { cols } from "@/db";

/**
 * Sliding-window rate limiter stored in MongoDB (works across app instances, no Redis needed).
 *
 * Counts are kept per fixed window, but the decision also includes the previous window, weighted by
 * how much of it still falls inside the last `windowSeconds`. A plain fixed window lets up to twice
 * the limit through when attempts straddle a window boundary; this closes that gap.
 * Returns true when the action is allowed.
 */
export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const nowSec = Date.now() / 1000;
  const window = Math.floor(nowSec / windowSeconds);
  const elapsed = (nowSec - window * windowSeconds) / windowSeconds; // 0..1 into the current window
  const { rateLimits } = await cols();
  const [doc, prev] = await Promise.all([
    rateLimits.findOneAndUpdate(
      { _id: `${key}:${window}` },
      // Keep both windows long enough for the next window to read this one.
      { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date((window + 2) * windowSeconds * 1000) } },
      { upsert: true, returnDocument: "after" },
    ),
    rateLimits.findOne({ _id: `${key}:${window - 1}` }, { projection: { count: 1 } }),
  ]);
  const estimate = (doc?.count ?? 1) + (prev?.count ?? 0) * (1 - elapsed);
  return estimate <= limit;
}
