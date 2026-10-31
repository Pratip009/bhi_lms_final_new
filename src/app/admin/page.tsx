import type { Metadata } from "next";
import Link from "next/link";
import { cols } from "@/db";
import { requireAdmin } from "@/lib/auth";
import { describeEnrollment, pendingTemplates } from "@/lib/forms/templates";
import { eqissTextPending } from "@/lib/eqiss-text";
import { Alert } from "@/components/ui";
import { attendanceToDo, usersById } from "@/lib/queries";
import { Card, Empty, PageHeader, Stat, StatusBadge, fmtDate } from "@/components/ui";

export const metadata: Metadata = { title: "Home" };

export default async function AdminDashboard() {
  await requireAdmin();
  const { applications, enrollments, users, classes, courses, courseAssignments } = await cols();
  const assigned = new Set(await enrollments.distinct("studentId", { status: "ACTIVE" }));
  const approvedIds: string[] = await applications.distinct("studentId", { status: "APPROVED" });
  const [pending, corrections, active, instructorsPending, activeClasses, noInstructor] = await Promise.all([
    applications.countDocuments({ status: { $in: ["SUBMITTED", "RESUBMITTED"] } }),
    applications.countDocuments({ status: "CORRECTIONS_REQUESTED" }),
    enrollments.countDocuments({ status: "ACTIVE" }),
    users.countDocuments({ role: "INSTRUCTOR", instructorStatus: "PENDING" }),
    classes.countDocuments({ archived: false }),
    classes.countDocuments({ archived: false, "instructors.0": { $exists: false } }),
  ]);
  const [courseCount, coursesWithInstructor] = await Promise.all([
    courses.countDocuments({ archived: false }),
    courseAssignments.distinct("courseId", { removedAt: null }),
  ]);
  const pendingText = pendingTemplates();
  const unassigned = approvedIds.filter((id) => !assigned.has(id)).length;
  const queue = await applications.find({ status: { $in: ["SUBMITTED", "RESUBMITTED"] } }).sort({ submittedAt: 1 }).limit(8).toArray();
  const names = await usersById(queue.map((a) => a.studentId));
  const toConfirm = await attendanceToDo();
  const confirmClasses = new Map((await classes.find({ _id: { $in: toConfirm.map((t) => t.classId) } }, { projection: { code: 1 } }).toArray()).map((k) => [k._id, k.code]));

  const noFees = await courses.countDocuments({ archived: false, $or: [{ fees: null }, { fees: { $exists: false } }] });
  const coursesNoInstructor = Math.max(0, courseCount - coursesWithInstructor.length);
  // Plain-language to-do list: only what needs someone's attention, each with one button.
  const todo = [
    { n: pending, text: (n: number) => `${n} application${n === 1 ? "" : "s"} waiting for your review`, href: "/admin/applications?status=PENDING", button: "Review" },
    { n: instructorsPending, text: (n: number) => `${n} instructor sign-up${n === 1 ? "" : "s"} to approve`, href: "/admin/instructors", button: "Review" },
    { n: unassigned, text: (n: number) => `${n} approved student${n === 1 ? " has" : "s have"} no class`, href: "/admin/students?filter=unassigned", button: "Place" },
    { n: toConfirm.length, text: (n: number) => `${n} class day${n === 1 ? "" : "s"} with attendance not finished or not signed`, href: "#days", button: "See days" },
    { n: coursesNoInstructor, text: (n: number) => `${n} course${n === 1 ? " has" : "s have"} no instructor`, href: "/admin/courses", button: "Assign" },
    { n: noFees, text: (n: number) => `${n} course${n === 1 ? " has" : "s have"} no Private tuition set`, href: "/admin/courses", button: "Set" },
  ].filter((t) => t.n > 0);

  return (
    <>
      <PageHeader title="Home" description="What needs your attention today." />
      {courseCount === 0 && <div className="mb-6"><Alert tone="info">No courses yet. Ask your technical admin to load the BHI course list, or <Link href="/admin/courses" className="underline">add courses</Link> yourself.</Alert></div>}
      <Card title="To do">
        {todo.length === 0 ? <Empty>Nothing needs your attention right now.</Empty> : (
          <ul className="divide-y divide-line">
            {todo.map((t) => (
              <li key={t.href + t.button} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <span className="text-base">{t.text(t.n)}</span>
                <Link href={t.href} className="rounded-md bg-pine-700 px-4 py-1.5 text-sm font-semibold text-white">{t.button}</Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Students in class now" value={active} href="/admin/students" />
        <Stat label="Waiting on student corrections" value={corrections} href="/admin/applications?status=CORRECTIONS_REQUESTED" />
        <Stat label="Classes running" value={activeClasses} href="/admin/courses" />
        <Stat label="Approved students" value={approvedIds.length} href="/admin/students" />
      </div>
      {toConfirm.length > 0 && (
        <div className="mt-8" id="days">
          <Card title="Class days to finish or sign">
            <ul className="divide-y divide-line text-sm">
              {toConfirm.slice(0, 15).map((t) => (
                <li key={`${t.classId}:${t.date}`} className="flex justify-between gap-3 py-2">
                  <Link href={`/admin/classes/${t.classId}/attendance?date=${t.date}`} className="font-semibold text-pine-700 underline">{confirmClasses.get(t.classId) ?? "Class"}, {fmtDate(t.date)}</Link>
                  <span>{[t.pending ? `${t.pending} not filled in` : "", t.unsigned ? "not signed" : ""].filter(Boolean).join(", ")}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}
      <div className="mt-8">
        <Card title="Oldest applications waiting" actions={<Link href="/admin/applications" className="text-sm font-semibold text-pine-700 underline">All applications</Link>}>
          {queue.length === 0 ? (
            <Empty>No applications are waiting for review.</Empty>
          ) : (
            <ul className="divide-y divide-line">
              {queue.map((app) => (
                <li key={app._id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div>
                    <Link href={`/admin/applications/${app._id}`} className="font-semibold text-pine-700 underline">{names.get(app.studentId)?.name ?? "Student"}</Link>
                    <p className="text-sm text-slate-600">{describeEnrollment(app)}, submitted {fmtDate(app.submittedAt)}</p>
                  </div>
                  <StatusBadge status={app.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      {(pendingText.length > 0 || eqissTextPending()) && (
        <p className="mt-8 text-xs text-slate-500">
          Still waiting for official wording from BHI: {[...pendingText.map((t) => t.title), ...(eqissTextPending() ? ["EQISS report declarations"] : [])].join(", ")}.
        </p>
      )}
    </>
  );
}
