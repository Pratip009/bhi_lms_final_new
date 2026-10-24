import "server-only";
import { cookies, headers } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { cols, newId, type User } from "@/db";
import { env } from "@/lib/env";

export const SESSION_COOKIE = "bhi_session";
const SESSION_DAYS = 7;

const key = () => new TextEncoder().encode(env().SESSION_SECRET);

export type SessionClaims = { sid: string; uid: string; role: User["role"] };

export async function clientMeta() {
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || "unknown";
  return { ip, userAgent: (h.get("user-agent") ?? "").slice(0, 300) };
}

export async function createSession(user: Pick<User, "_id" | "role">) {
  const meta = await clientMeta();
  const { sessions } = await cols();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  const sid = newId();
  await sessions.insertOne({ _id: sid, userId: user._id, expiresAt, revokedAt: null, ip: meta.ip, userAgent: meta.userAgent, createdAt: new Date() });
  const token = await new SignJWT({ sid, uid: user._id, role: user.role } satisfies SessionClaims)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .sign(key());
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env().NODE_ENV === "production" && env().APP_URL.startsWith("https://"),
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function readClaims(): Promise<SessionClaims | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] });
    return payload as unknown as SessionClaims;
  } catch {
    return null;
  }
}

/** Full check against the database: session not revoked/expired, user active, password not changed since. */
export async function getSessionUser(): Promise<User | null> {
  const claims = await readClaims();
  if (!claims) return null;
  const { sessions, users } = await cols();
  const session = await sessions.findOne({ _id: claims.sid, revokedAt: null, expiresAt: { $gt: new Date() } });
  if (!session || session.userId !== claims.uid) return null;
  const user = await users.findOne({ _id: session.userId });
  if (!user || user.disabledAt) return null;
  if (session.createdAt < user.passwordChangedAt) return null;
  return user;
}

export async function destroySession() {
  const claims = await readClaims();
  if (claims) {
    const { sessions } = await cols();
    await sessions.updateOne({ _id: claims.sid }, { $set: { revokedAt: new Date() } });
  }
  (await cookies()).delete(SESSION_COOKIE);
}

export async function revokeAllSessions(userId: string) {
  const { sessions } = await cols();
  await sessions.updateMany({ userId, revokedAt: null }, { $set: { revokedAt: new Date() } });
}
