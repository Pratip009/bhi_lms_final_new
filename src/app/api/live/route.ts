import { apiUser, deny } from "@/lib/http";
import { todayOverview } from "@/lib/live";

/** Admins: every class running today with live check-in and sheet counts. */
export async function GET() {
  const user = await apiUser();
  if (!user) return deny(401);
  if (user.role !== "ADMIN") return deny();
  return Response.json(await todayOverview(), { headers: { "Cache-Control": "no-store, max-age=0", "X-Robots-Tag": "noindex" } });
}
