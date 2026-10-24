import "server-only";
import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

/** API-key check for the existing attendance app. Disabled when INTEGRATION_API_KEY is empty. */
export function integrationAuthorized(req: Request) {
  const key = env().INTEGRATION_API_KEY;
  if (!key || key.length < 24) return false;
  const given = req.headers.get("x-api-key") ?? "";
  const a = Buffer.from(given);
  const b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b);
}
