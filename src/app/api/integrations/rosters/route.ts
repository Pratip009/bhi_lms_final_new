import { cols } from "@/db";
import { integrationAuthorized } from "@/lib/integration";
import { coursesById, usersById } from "@/lib/queries";
import { attendanceFormatFor } from "@/lib/forms/templates";

/** Read-only roster feed for the existing attendance app. The LMS owns students and classes. */
export async function GET(req: Request) {
  if (!integrationAuthorized(req)) return new Response("Unauthorized", { status: 401 });
  const { classes, enrollments } = await cols();
  const ks = await classes.find({ archived: false }).toArray();
  const active = await enrollments.find({ status: "ACTIVE", classId: { $in: ks.map((k) => k._id) } }).toArray();
  const cs = await coursesById(ks.map((k) => k.courseId));
  const people = await usersById(active.map((e) => e.studentId));
  // Which sheet each student uses: MONTHLY (DFS / Private, handwritten app) or BIWEEKLY (EQISS / One-Stop).
  const apps = new Map((await (await cols()).applications.find({ studentId: { $in: active.map((e) => e.studentId) } }, { projection: { studentId: 1, category: 1 } }).toArray()).map((a) => [a.studentId, a.category]));
  return Response.json(
    {
      classes: ks.map((k) => ({
        id: k._id, code: k.code, cohort: k.cohort, course: cs.get(k.courseId)?.name ?? "", startDate: k.startDate, endDate: k.endDate,
        students: active.filter((e) => e.classId === k._id).map((e) => ({ enrollmentId: e._id, studentId: e.studentId, name: people.get(e.studentId)?.name ?? "", sheet: attendanceFormatFor(apps.get(e.studentId)) })),
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
