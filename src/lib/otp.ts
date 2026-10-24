import "server-only";
import { cols, newId } from "@/db";
import { env } from "@/lib/env";
import { generateOtp, hmac, safeEqualHex } from "@/lib/crypto";
import { rateLimit } from "@/lib/rate-limit";

type Purpose = "VERIFY_EMAIL" | "RESET_PASSWORD";

export const OTP_TTL_MINUTES = 10;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_SECONDS = 60;
const OTP_MAX_SENDS_PER_HOUR = 5;

const hashCode = (userId: string, purpose: Purpose, code: string) => hmac(env().SESSION_SECRET, `${userId}:${purpose}:${code}`);

export type IssueResult = { ok: true; code: string } | { ok: false; reason: "COOLDOWN" | "LIMIT"; retryAfter?: number };

/** Creates a new code, invalidating earlier unused codes for the same purpose. */
export async function issueOtp(userId: string, purpose: Purpose): Promise<IssueResult> {
  const { otpCodes } = await cols();
  const latest = await otpCodes.findOne({ userId, purpose }, { sort: { createdAt: -1 }, projection: { createdAt: 1 } });
  if (latest) {
    const elapsed = (Date.now() - latest.createdAt.getTime()) / 1000;
    if (elapsed < OTP_RESEND_COOLDOWN_SECONDS) return { ok: false, reason: "COOLDOWN", retryAfter: Math.ceil(OTP_RESEND_COOLDOWN_SECONDS - elapsed) };
  }
  if (!(await rateLimit(`otp-send:${purpose}:${userId}`, OTP_MAX_SENDS_PER_HOUR, 3600))) return { ok: false, reason: "LIMIT" };

  const code = generateOtp();
  const now = new Date();
  await otpCodes.updateMany({ userId, purpose, consumedAt: null }, { $set: { consumedAt: now } });
  await otpCodes.insertOne({
    _id: newId(), userId, purpose, codeHash: hashCode(userId, purpose, code), attempts: 0,
    expiresAt: new Date(now.getTime() + OTP_TTL_MINUTES * 60_000), consumedAt: null, createdAt: now,
  });
  return { ok: true, code };
}

export type VerifyResult = "OK" | "INVALID" | "EXPIRED" | "TOO_MANY_ATTEMPTS" | "NO_CODE";

/**
 * Checks a code. The attempt counter is incremented atomically *before* comparing, so parallel
 * guesses can't exceed OTP_MAX_ATTEMPTS. A match is consumed with a conditional update so it works once.
 */
export async function verifyOtp(userId: string, purpose: Purpose, code: string): Promise<VerifyResult> {
  if (!/^\d{6}$/.test(code)) return "INVALID";
  const { otpCodes } = await cols();
  const current = await otpCodes.findOne({ userId, purpose, consumedAt: null }, { sort: { createdAt: -1 } });
  if (!current) return "NO_CODE";
  if (current.expiresAt < new Date()) return "EXPIRED";
  const row = await otpCodes.findOneAndUpdate(
    { _id: current._id, consumedAt: null, attempts: { $lt: OTP_MAX_ATTEMPTS } },
    { $inc: { attempts: 1 } },
    { returnDocument: "after" },
  );
  if (!row) return "TOO_MANY_ATTEMPTS";
  if (!safeEqualHex(row.codeHash, hashCode(userId, purpose, code))) {
    return row.attempts >= OTP_MAX_ATTEMPTS ? "TOO_MANY_ATTEMPTS" : "INVALID";
  }
  const used = await otpCodes.updateOne({ _id: row._id, consumedAt: null }, { $set: { consumedAt: new Date() } });
  return used.modifiedCount === 1 ? "OK" : "NO_CODE";
}
