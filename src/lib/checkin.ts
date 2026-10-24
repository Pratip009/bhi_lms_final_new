// Rules for live student check-in. Pure functions (the secret is passed in), so they can be unit-tested.
import { createHmac, timingSafeEqual } from "node:crypto";
import type { AttendanceRecord, CheckInEntry, CheckInSession } from "@/db";

/** A new code appears every 30 seconds; the previous one is still accepted, so a code lives 30 to 60 seconds. */
export const CODE_PERIOD_SECONDS = 30;
/** Check-in closes itself after this long even if the instructor forgets. */
export const MAX_OPEN_MINUTES = 240;
export const DEFAULT_LATE_AFTER_MINUTES = 10;

type Codeable = Pick<CheckInSession, "_id" | "seed">;

const windowOf = (now: Date) => Math.floor(now.getTime() / (CODE_PERIOD_SECONDS * 1000));

export function codeFor(secret: string, s: Codeable, window: number): string {
  const h = createHmac("sha256", secret).update(`checkin:${s._id}:${s.seed}:${window}`).digest();
  return (h.readUInt32BE(0) % 1_000_000).toString().padStart(6, "0");
}

export function currentCode(secret: string, s: Codeable, now = new Date()) {
  const w = windowOf(now);
  const nextChangeMs = (w + 1) * CODE_PERIOD_SECONDS * 1000 - now.getTime();
  return { code: codeFor(secret, s, w), secondsLeft: Math.max(1, Math.ceil(nextChangeMs / 1000)) };
}

/** Accepts the code on screen now or the one just before it (covers a student typing as it changes). */
export function codeMatches(secret: string, s: Codeable, code: string, now = new Date()): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  const w = windowOf(now);
  let ok = false;
  for (const win of [w, w - 1]) {
    // Compare every candidate in constant time, without stopping early.
    ok = timingSafeEqual(Buffer.from(codeFor(secret, s, win)), Buffer.from(code)) || ok;
  }
  return ok;
}

export const isOpen = (s: Pick<CheckInSession, "closedAt" | "expiresAt">, now = new Date()) => !s.closedAt && s.expiresAt > now;

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
 * Check-ins the instructor still has to act on: the student checked in, but the saved sheet has no
 * mark for them, or marked them absent before they checked in (the sheet was saved first). An absent
 * mark saved after the check-in is the instructor's decision (e.g. someone checked in for a friend).
 */
export function unconfirmed(
  entries: Record<string, Pick<CheckInEntry, "at">>,
  records: Record<string, Pick<AttendanceRecord, "status" | "updatedAt">> | undefined,
): string[] {
  return Object.entries(entries)
    .filter(([eid, e]) => {
      const r = records?.[eid];
      return !r || (r.status === "ABSENT" && r.updatedAt < e.at);
    })
    .map(([eid]) => eid);
}
