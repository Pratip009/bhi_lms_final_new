import { cols } from "@/db";
import { env } from "@/lib/env";
import { assertCanManageClass } from "@/lib/authz";
import { apiUser, deny, isUuid } from "@/lib/http";
import { usersById } from "@/lib/queries";
import { todayLocal, timeLocal } from "@/lib/dates";
import { currentCode, isOpen, sharedDevices } from "@/lib/checkin";

/**
 * Live state of today's check-in for the instructor's screen: the current code and who has checked in.
 * Only the class's instructors and admins can read it; never cached, because the code rotates.
 */
export async function GET(_: Request, { params }: { params: Promise<{ classId: string }> }) {
  const user = await apiUser();
  if (!user) return deny(401);
  const { classId } = await params;
  if (!isUuid(classId)) return deny();
  try {
    await assertCanManageClass(user, classId);
  } catch {
    return deny();
  }
  const { checkIns, enrollments } = await cols();
  const now = new Date();
  const session = await checkIns.findOne({ classId, date: todayLocal() });
  const active = await enrollments.find({ classId, status: "ACTIVE" }, { projection: { _id: 1, studentId: 1 } }).toArray();
  const names = await usersById(active.map((e) => e.studentId));
  const nameOf = new Map(active.map((e) => [e._id, names.get(e.studentId)?.name ?? "Student"]));
  const shared = session ? sharedDevices(session.entries) : new Map<string, string[]>();
  const entries = session
    ? Object.entries(session.entries)
        .map(([eid, e]) => ({
          name: nameOf.get(eid) ?? "Former student",
          time: timeLocal(e.at),
          at: e.at.getTime(),
          status: e.status,
          sameDeviceAs: (shared.get(eid) ?? []).map((x) => nameOf.get(x) ?? "another student"),
        }))
        .sort((a, b) => a.at - b.at)
    : [];
  const open = !!session && isOpen(session, now);
  const body = {
    exists: !!session,
    open,
    ...(open ? currentCode(env().SESSION_SECRET, session!, now) : { code: null, secondsLeft: null }),
    lateAfterMinutes: session?.lateAfterMinutes ?? null,
    openedAt: session ? timeLocal(session.openedAt) : null,
    closesAt: session && open ? timeLocal(session.expiresAt) : null,
    enrolled: active.length,
    entries,
  };
  return Response.json(body, { headers: { "Cache-Control": "no-store, max-age=0", "X-Robots-Tag": "noindex" } });
}
