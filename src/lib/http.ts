import "server-only";
import { getSessionUser } from "@/lib/session";

export const isUuid = (s: string | null | undefined): s is string => !!s && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

export async function apiUser() {
  const user = await getSessionUser();
  return user && user.emailVerifiedAt ? user : null;
}

export const deny = (status = 404) => new Response(status === 401 ? "Sign in required" : "Not found", { status });

export function fileResponse(body: Uint8Array | Buffer, mime: string, filename: string, inline = true) {
  const safe = filename.replace(/[^\w.\- ]+/g, "_");
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": mime,
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${safe}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
    },
  });
}

/** Neutralises spreadsheet formula injection in CSV cells. */
export function csvCell(v: unknown) {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}
