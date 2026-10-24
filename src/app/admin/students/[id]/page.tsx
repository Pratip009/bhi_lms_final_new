import Link from "next/link";
import { notFound } from "next/navigation";
import { cols } from "@/db";
import { requireAdmin } from "@/lib/auth";
import { describeEnrollment } from "@/lib/forms/templates";
import { attendanceForEnrollment, classOptions, coursesById } from "@/lib/queries";
import { AttendanceTable } from "@/components/attendance-table";
import { ActionButton, AssignClassForm } from "@/components/action-widgets";
import { Card, PageHeader, StatusBadge, fmtDate } from "@/components/ui";
import { assignStudentAction, endEnrollmentAction, setAccountDisabledAction } from "../../actions";

export default async function StudentRecord({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const { users, applications, enrollments, classes, progressReports } = await cols();
  const student = await users.findOne({ _id: id });
  if (!student || student.role !== "STUDENT") notFound();
  const app = await applications.findOne({ studentId: id }, { projection: { status: 1, category: 1, county: 1 } });
  const list = await enrollments.find({ studentId: id }).sort({ assignedAt: 1 }).toArray();
  const ks = await classes.find({ _id: { $in: list.map((e) => e.classId) } }).toArray();
  const cs = await coursesById(ks.map((k) => k.courseId));
  const rows = list.map((e) => {
    const klass = ks.find((k) => k._id === e.classId)!;
    return { e, klass, course: cs.get(klass.courseId)! };
  });
  const reports = await progressReports.find({ enrollmentId: { $in: list.map((e) => e._id) } }, { projection: { data: 0 } }).toArray();
  const attendance = await Promise.all(list.map((e) => attendanceForEnrollment(e)));
  const options = app?.status === "APPROVED" ? await classOptions() : [];

  return (
    <>
      <Link href="/admin/students" className="text-sm text-pine-700 underline">Students</Link>
      <PageHeader title={student.name}
        description={<>{student.email}, {app ? describeEnrollment(app) : "-"} {app && <StatusBadge status={app.status} />}</>}
        actions={<>
          {app && <Link href={`/admin/applications/${app._id}`} className="rounded-md border border-line bg-white px-4 py-2 text-sm font-semibold">Application</Link>}
          <ActionButton action={setAccountDisabledAction.bind(null, student._id)} variant="ghost"
            label={student.disabledAt ? "Re-enable account" : "Disable account"} hidden={{ disable: student.disabledAt ? "false" : "true" }}
            confirm={student.disabledAt ? undefined : "Disable this account? They are signed out immediately and can't sign in."} />
        </>} />
      {student.disabledAt && <p className="mb-4 text-sm font-semibold text-brick-600">This account is disabled (since {fmtDate(student.disabledAt)}).</p>}
      {app?.status === "APPROVED" && (
        <Card title="Add to a section" className="mb-6">
          {options.length ? <AssignClassForm action={assignStudentAction} studentId={student._id} classes={options} /> : <p className="text-sm">No active classes. <Link href="/admin/courses" className="underline">Create one</Link>.</p>}
        </Card>
      )}
      <div className="space-y-6">
        {rows.map(({ e, klass, course }, i) => (
          <Card key={e._id} title={`${course.name}: ${klass.code}, ${klass.cohort}`} actions={<StatusBadge status={e.status} />}>
            <p className="mb-4 text-sm text-slate-600">Assigned {fmtDate(e.assignedAt)}{e.endedAt ? `, ended ${fmtDate(e.endedAt)}` : ""}{e.endReason ? ` (${e.endReason})` : ""}. <Link href={`/admin/classes/${klass._id}`} className="text-pine-700 underline">Section roster</Link>{" · "}
              <Link href={`/admin/attendance/sheets/${e._id}`} className="font-semibold text-pine-700 underline">{app?.category === "EQISS" ? "Biweekly attendance report" : "Monthly attendance sheet"}</Link></p>
            <AttendanceTable rows={attendance[i]} />
            <h3 className="mb-2 mt-6 text-sm font-semibold">Monthly progress reports</h3>
            <ul className="text-sm">
              {reports.filter((r) => r.enrollmentId === e._id).sort((a, b) => b.month.localeCompare(a.month)).map((r) => (
                <li key={r._id}><Link href={`/admin/reports/${r._id}`} className="text-pine-700 underline">{r.month}</Link> ({r.status === "SUBMITTED" ? "submitted" : "draft"})</li>
              ))}
              {!reports.some((r) => r.enrollmentId === e._id) && <li className="text-slate-500">None yet.</li>}
            </ul>
            {e.status === "ACTIVE" && (
              <div className="mt-5 flex flex-wrap gap-2 border-t border-line pt-4">
                <ActionButton action={endEnrollmentAction} label="Mark completed" variant="secondary" hidden={{ enrollmentId: e._id, status: "COMPLETED" }} />
                <ActionButton action={endEnrollmentAction} label="Withdraw" variant="secondary" hidden={{ enrollmentId: e._id, status: "WITHDRAWN" }} confirm="Withdraw the student from this class? Their records are kept." />
              </div>
            )}
          </Card>
        ))}
        {!rows.length && <p className="text-sm text-slate-600">Not enrolled in any class.</p>}
      </div>
    </>
  );
}
