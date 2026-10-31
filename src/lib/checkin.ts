// Rules for live student check-in. Pure functions (the secret is passed in), so they can be unit-tested.
import { createHmac, timingSafeEqual } from "node:crypto";
import type { CheckInEntry, CheckInSession } from "@/db";

/** Each code works for exactly this long. Checking in with the first code of the day counts as on time. */
export const CODE_VALID_MINUTES = 10;
export const CODE_VALID_MS = CODE_VALID_MINUTES * 60_000;

type Codeable = Pick<CheckInSession, "_id" | "seed">;

/**
 * The 6-digit code for one issued code (session id + seed). Derived with an HMAC of the server secret,
 * so it is never stored in plain text and can't be predicted; a new code (new seed) gives a new number.
 */
export function codeFor(secret: string, s: Codeable): string {
  const h = createHmac("sha256", secret).update(`checkin:${s._id}:${s.seed}`).digest();
  return (h.readUInt32BE(0) % 1_000_000).toString().padStart(6, "0");
}

/** Constant-time comparison with the current code. Expiry is checked separately (and atomically in the database). */
export function codeMatches(secret: string, s: Codeable, code: string): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  return timingSafeEqual(Buffer.from(codeFor(secret, s)), Buffer.from(code));
}

export const isOpen = (s: Pick<CheckInSession, "closedAt" | "expiresAt">, now = new Date()) => !s.closedAt && s.expiresAt > now;

/** Milliseconds the current code still works (0 when closed or expired). */
export const msLeft = (s: Pick<CheckInSession, "closedAt" | "expiresAt">, now = new Date()) =>
  isOpen(s, now) ? s.expiresAt.getTime() - now.getTime() : 0;

/**
 * On time = within the first CODE_VALID_MINUTES after the day's first code was issued (inclusive).
 * lateAfterMinutes is stored on the session (always CODE_VALID_MINUTES for new sessions).
 */
export function statusAt(s: Pick<CheckInSession, "openedAt" | "lateAfterMinutes">, now = new Date()): CheckInEntry["status"] {
  return now.getTime() - s.openedAt.getTime() <= s.lateAfterMinutes * 60_000 ? "PRESENT" : "LATE";
}

/** Students who checked in from the same device as someone else in the same session (possible proxy check-in). */
export function sharedDevices(entries: Record<string, Pick<CheckInEntry, "deviceId">>): Map<string, string[]> {
  const byDevice = new Map<string, string[]>();
  for (const [eid, e] of Object.entries(entries)) byDevice.set(e.deviceId, [...(byDevice.get(e.deviceId) ?? []), eid]);
  const out = new Map<string, string[]>();
  for (const ids of byDevice.values()) if (ids.length > 1) for (const id of ids) out.set(id, ids.filter((x) => x !== id));
  return out;
}

/**
 * On time or late for a check-in at local time `nowHHMM`: late when more than `lateAfterMinutes` after the
 * class start time. Classes without a start time fall back to `fallback` (the first-code rule above).
 */
export function checkInStatus(nowHHMM: string, sessionStart: string | null | undefined, lateAfterMinutes: number, fallback: CheckInEntry["status"]): CheckInEntry["status"] {
  if (!sessionStart || !/^\d{2}:\d{2}$/.test(sessionStart)) return fallback;
  const m = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  return m(nowHHMM) > m(sessionStart) + Math.max(0, lateAfterMinutes) ? "LATE" : "PRESENT";
}
