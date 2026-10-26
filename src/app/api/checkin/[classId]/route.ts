import { assertCanManageClass } from "@/lib/authz";
import { apiUser, deny, isUuid } from "@/lib/http";
import { todayLocal } from "@/lib/dates";
import { loadDayBoard } from "@/lib/live";

const NO_STORE = { "Cache-Control": "no-store, max-age=0", "X-Robots-Tag": "noindex" };

/**
 * Live attendance board for one class and date (default today): the check-in code while it's valid,
 * who has checked in and filled out, the day's totals and the instructor's signature.
 * Only the class's instructors and admins can read it. Never cached.
 */
export async function GET(req: Request, { params }: { params: Promise<{ classId: string }> }) {
  const user = await apiUser();
  if (!user) return deny(401);
  const { classId } = await params;
  if (!isUuid(classId)) return deny();
  try {
    await assertCanManageClass(user, classId);
  } catch {
    return deny();
  }
  const q = new URL(req.url).searchParams.get("date") ?? "";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(q) ? q : todayLocal();
  const board = await loadDayBoard(classId, date, { includeCode: true });
  if (!board) return deny();
  // `entries` and `enrolled` keep the shape older screens and tests used.
  const entries = board.rows.filter((r) => r.checkIn).map((r) => ({ name: r.name, time: r.checkIn!.time, status: r.checkIn!.late ? "LATE" : "PRESENT", sameDeviceAs: r.attention?.startsWith("Same phone") ? [r.attention] : [] }));
  return Response.json({ ...board, open: board.checkIn.open, code: board.checkIn.code, enrolled: board.rows.length, entries }, { headers: NO_STORE });
}
