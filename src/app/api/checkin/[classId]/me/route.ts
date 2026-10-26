import { apiUser, deny, isUuid } from "@/lib/http";
import { studentDayState } from "@/lib/live";

/** A student's own check-in state for one of their classes today (never the code). Polled by the dashboard. */
export async function GET(_: Request, { params }: { params: Promise<{ classId: string }> }) {
  const user = await apiUser();
  if (!user) return deny(401);
  if (user.role !== "STUDENT") return deny();
  const { classId } = await params;
  if (!isUuid(classId)) return deny();
  const state = await studentDayState(user._id, classId);
  if (!state) return deny();
  return Response.json(state, { headers: { "Cache-Control": "no-store, max-age=0", "X-Robots-Tag": "noindex" } });
}
