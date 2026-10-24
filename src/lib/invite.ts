import "server-only";
import { randomBytes } from "node:crypto";
import { env } from "@/lib/env";
import { hmac } from "@/lib/crypto";

/** Instructor invites: a one-time link, valid for this many days. */
export const INVITE_TTL_DAYS = 7;

/** Random URL-safe token for the email link; only its keyed hash is stored, so a database leak can't be used to activate accounts. */
export function newInviteToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: inviteHash(token), expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000) };
}

export const inviteHash = (token: string) => hmac(env().SESSION_SECRET, `invite:${token}`);

/** Tokens are exactly 43 base64url characters; anything else is rejected before touching the database. */
export const isWellFormedToken = (t: string) => /^[A-Za-z0-9_-]{43}$/.test(t);