import Link from "next/link";
import { notFound } from "next/navigation";
import { cols } from "@/db";
import { requireAdmin } from "@/lib/auth";
import { coursesById, rosterForClass, usersById } from "@/lib/queries";
import { ActionButton, AssignCourseForm, AssignInstructorClassForm } from "@/components/action-widgets";
import { instructorClassFilter } from "@/lib/authz";
import { Badge, Card, Empty, PageHeader, StatusBadge, Table, Td, fmtDate } from "@/components/ui";
import {
  assignClassToInstructorAction, assignCourseToInstructorAction, decideInstructorAction, removeCourseAssignmentAction, removeInstructorAction, setAccountDisabledAction,
} from "../../actions";
import { thisMonthLocal } from "@/lib/dates";

export default async function InstructorDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ month?: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const { users, classes, progressReports, courseAssignments, courses } = await cols();
  const inst = await users.findOne({ _id: id, role: "INSTRUCTOR" });
  if (!inst) notFound();
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? sp.month! : thisMonthLocal();
  const assignments = await courseAssignments.find({ instructorId: id }).sort({ assignedAt: -1 }).toArray();
  const activeAssignments = assignments.filter((a) => !a.removedAt);
  const ks = await classes.find(await instructorClassFilter(id)).sort({ archived: 1, startDate: 1 }).toArray();
  const allCourses = await courses.find({}).sort({ name: 1 }).toArray();
  const courseName = new Map(allCourses.map((c) => [c._id, c.name]));
  const assignableCourses = allCourses.filter((c) => !c.archived && !activeAssignments.some((a) => a.courseId === c._id)).map((c) => ({ id: c._id, label: c.name }));
  const cs = await coursesById(ks.map((k) => k.courseId));
  const rosters = await Promise.all(ks.map((k) => rosterForClass(k._id)));
  const reports = await progressReports.find({ enrollmentId: { $in: rosters.flat().map((r) => r.enrollment._id) }, month }, { projection: { data: 0 } }).toArray();

  // Classes this instructor could be given: open classes of open courses, not already theirs.
  const openClasses = await classes.find({ archived: false, "instructors.instructorId": { $ne: id } }).sort({ startDate: 1 }).toArray();
  const openCourses = await coursesById(openClasses.map((k) => k.courseId));
  const leadNames = await usersById(openClasses.flatMap((k) => k.instructors.filter((i) => i.role === "LEAD").map((i) => i.instructorId)));
  const classOptions = openClasses
    .filter((k) => openCourses.get(k.courseId) && !openCourses.get(k.courseId)!.archived)
    .map((k) => {
      const lead = k.instructors.find((i) => i.role === "LEAD");
      return {
        id: k._id,
        label: `${openCourses.get(k.courseId)!.name}: ${k.code}, ${k.cohort} (${fmtDate(k.startDate)} to ${fmtDate(k.endDate)})${lead ? ` · lead: ${leadNames.get(lead.instructorId)?.name ?? "assigned"}` : " · no lead yet"}`,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
  const canAssign = inst.instructorStatus === "APPROVED" && !inst.disabledAt;

  return (
    <>
      <Link href="/admin/instructors" className="text-sm text-pine-700 underline">Instructors</Link>
      <PageHeader title={inst.name} description={<>{inst.email} <StatusBadge status={inst.instructorStatus ?? ""} /></>}
        actions={<>
          {inst.instructorStatus !== "APPROVED" && <ActionButton action={decideInstructorAction.bind(null, inst._id)} label="Approve" hidden={{ decision: "APPROVED" }} />}
          {inst.instructorStatus === "PENDING" && <ActionButton action={decideInstructorAction.bind(null, inst._id)} label="Reject" variant="danger" hidden={{ decision: "REJECTED" }} confirm="Reject this instructor sign-up?" />}
          {inst.instructorStatus === "APPROVED" && <ActionButton action={decideInstructorAction.bind(null, inst._id)} label="Revoke approval" variant="secondary" hidden={{ decision: "REJECTED" }} confirm="Revoke approval? They'll be removed from all classes." />}
          <ActionButton action={setAccountDisabledAction.bind(null, inst._id)} variant="ghost"
            label={inst.disabledAt ? "Re-enable account" : "Disable account"} hidden={{ disable: inst.disabledAt ? "false" : "true" }}
            confirm={inst.disabledAt ? undefined : "Disable this account? They are signed out immediately and can't sign in."} />
        </>} />
      <form className="mb-5 flex items-center gap-2 text-sm">
        <label htmlFor="month">Reports for</label>
        <input id="month" type="month" name="month" defaultValue={month} className="rounded-md border border-line px-2 py-1" />
        <button className="rounded-md border border-line bg-white px-3 py-1 font-semibold">Show</button>
      </form>
      <Card title="Courses" className="mb-6">
        {activeAssignments.length === 0 ? <p className="mb-4 text-sm text-slate-600">No courses assigned.</p> : (
          <ul className="mb-4 divide-y divide-line">
            {activeAssignments.map((a) => (
              <li key={a._id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span><strong>{courseName.get(a.courseId) ?? "Course"}</strong> <span className="text-slate-500">since {fmtDate(a.assignedAt)}</span></span>
                <ActionButton action={removeCourseAssignmentAction} label="Remove" variant="ghost" hidden={{ assignmentId: a._id }}
                  confirm={`Remove ${inst.name} from ${courseName.get(a.courseId)}? Records they already wrote are kept.`} />
              </li>
            ))}
          </ul>
        )}
        {canAssign && assignableCourses.length > 0 && <AssignCourseForm action={assignCourseToInstructorAction.bind(null, inst._id)} courses={assignableCourses} />}
        {!canAssign && <p className="text-sm text-slate-600">{inst.disabledAt ? "This account is disabled." : "Approve the instructor before assigning courses."}</p>}
        {assignments.some((a) => a.removedAt) && (
          <p className="mt-4 text-xs text-slate-500">Earlier: {assignments.filter((a) => a.removedAt).map((a) => `${courseName.get(a.courseId) ?? "course"} (${fmtDate(a.assignedAt)} to ${fmtDate(a.removedAt)})`).join("; ")}</p>
        )}
      </Card>
      <Card title="Assign to one class only (optional)" className="mb-6">
        {!canAssign ? (
          <p className="text-sm text-slate-600">{inst.disabledAt ? "This account is disabled. Re-enable it to assign classes." : "Only approved instructors can be assigned to classes."}</p>
        ) : classOptions.length === 0 ? (
          <p className="text-sm text-slate-600">No other open classes. <Link href="/admin/courses" className="underline">Create a class</Link> first.</p>
        ) : (
          <>
            {!inst.emailVerifiedAt && <p className="mb-3 text-sm text-marigold-700">{inst.name} hasn't activated their account yet. You can still assign classes; they'll see them after setting a password.</p>}
            <AssignInstructorClassForm action={assignClassToInstructorAction.bind(null, inst._id)} classes={classOptions} />
          </>
        )}
      </Card>
      {ks.length === 0 ? <Empty>No classes yet in this instructor's courses.</Empty> : (
        <div className="space-y-6">
          {ks.map((klass, i) => {
            const role = klass.instructors.find((x) => x.instructorId === id)?.role;
            return (
              <Card key={klass._id} title={`${cs.get(klass.courseId)?.name ?? ""}: ${klass.code}, ${klass.cohort}${role ? ` (${role === "LEAD" ? "Lead" : "Assistant"})` : " (via course)"}`}
                actions={<div className="flex items-center gap-3">
                  {klass.archived && <Badge tone="neutral">Archived</Badge>}
                  <Link href={`/admin/classes/${klass._id}`} className="text-sm text-pine-700 underline">Class page</Link>
                  {role && <ActionButton action={removeInstructorAction.bind(null, klass._id)} label="Remove from class" variant="ghost" hidden={{ instructorId: inst._id }} confirm={`Remove ${inst.name} from ${klass.code}?`} />}
                </div>}>
                <p className="mb-3 text-sm text-slate-600">{fmtDate(klass.startDate)} to {fmtDate(klass.endDate)}</p>
                {rosters[i].length === 0 ? <Empty>No students in this class.</Empty> : (
                  <Table head={["Student", "Status", "Attendance", `Report ${month}`]}>
                    {rosters[i].map(({ enrollment, student }) => {
                      const rep = reports.find((r) => r.enrollmentId === enrollment._id);
                      return (
                        <tr key={enrollment._id}>
                          <Td><Link href={`/admin/students/${student._id}`} className="font-semibold text-pine-700 underline">{student.name}</Link></Td>
                          <Td><StatusBadge status={enrollment.status} /></Td>
                          <Td><Link href={`/admin/attendance/sheets/${enrollment._id}`} className="underline">Attendance sheet</Link></Td>
                          <Td>{rep ? <Link href={`/admin/reports/${rep._id}`} className="underline">{rep.status === "SUBMITTED" ? "Submitted" : "Draft"}</Link> : <span className="text-slate-500">Not started</span>}</Td>
                        </tr>
                      );
                    })}
                  </Table>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
