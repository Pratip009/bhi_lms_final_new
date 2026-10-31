import Link from "next/link";
import { localDateOf, timeLocal, todayLocal, thisMonthLocal } from "@/lib/dates";
import { notFound } from "next/navigation";
import { cols } from "@/db";
import { requireAdmin } from "@/lib/auth";
import { CATEGORY_LABELS, describeEnrollment } from "@/lib/forms/templates";
import { getClassWithCourse, instructorsForClasses, rosterForClass, usersById } from "@/lib/queries";
import { ActionButton, AssignInstructorForm, ClassForm, MergeSectionsForm, MoveStudentForm } from "@/components/action-widgets";
import { AssignStudentToThisClass } from "@/components/assign-student";
import { Card, Empty, PageHeader, StatusBadge, Table, Td, fmtDate } from "@/components/ui";
import { LiveDayBoard } from "@/components/live-day-board";
import { ClassSettingsForm } from "@/components/class-settings-form";
import { startCheckInAction, closeCheckInAction, completeDayAction, signDayAction } from "@/lib/actions/checkin";
import { saveClassSettingsAction, sendClassroomLinkAction } from "@/lib/actions/class-settings";
import {
  archiveClassAction, assignInstructorAction, endEnrollmentAction, mergeSectionsAction, moveStudentAction, removeInstructorAction, saveClassAction,
} from "../../actions";

export default async function AdminClassPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const row = await getClassWithCourse(id);
  if (!row) notFound();
  const { klass, course } = row;
  const { users, applications, classSessions, progressReports, classes, courses, courseAssignments } = await cols();
  const roster = await rosterForClass(id);
  const instructors = await instructorsForClasses([klass]);
  const approvedInstructors = await users.find({ role: "INSTRUCTOR", instructorStatus: "APPROVED", disabledAt: null }, { projection: { _id: 1, name: 1, email: 1 } }).sort({ name: 1 }).toArray();

  // Approved students not already active in this class.
  const approvedIds: string[] = await applications.distinct("studentId", { status: "APPROVED" });
  const disabled = new Set((await users.find({ _id: { $in: approvedIds }, disabledAt: { $ne: null } }, { projection: { _id: 1 } }).toArray()).map((u) => u._id));
  const activeIds = new Set(roster.filter((r) => r.enrollment.status === "ACTIVE").map((r) => r.student._id));
  const assignable = [...(await usersById(approvedIds.filter((s) => !activeIds.has(s) && !disabled.has(s)))).values()].sort((a, b) => a.name.localeCompare(b.name));

  const sessions = await classSessions.find({ classId: id }).toArray();
  const thisMonth = thisMonthLocal();
  const reports = await progressReports.find({ enrollmentId: { $in: roster.map((r) => r.enrollment._id) }, month: thisMonth }, { projection: { data: 0 } }).toArray();
  const today = todayLocal();
  const appsByStudent = new Map((await applications.find({ studentId: { $in: roster.map((r) => r.student._id) } }, { projection: { studentId: 1, category: 1, county: 1 } }).toArray()).map((a) => [a.studentId, a]));
  // Sections a student can be moved to: open sections of any open course (same course first).
  const openCourses = new Map((await courses.find({ archived: false }).toArray()).map((c) => [c._id, c]));
  const openSections = (await classes.find({ archived: false, _id: { $ne: id } }).sort({ startDate: 1 }).toArray()).filter((k) => openCourses.has(k.courseId));
  const moveTargets = openSections
    .map((k) => ({ id: k._id, label: `${k.courseId === klass.courseId ? "" : "[other course] "}${openCourses.get(k.courseId)!.name}: ${k.code}, ${k.cohort}`, same: k.courseId === klass.courseId }))
    .sort((a, b) => Number(b.same) - Number(a.same) || a.label.localeCompare(b.label));
  const mergeable = openSections.filter((k) => k.courseId === klass.courseId).map((k) => ({ id: k._id, label: `${k.code}, ${k.cohort}` }));
  const courseInstructors = await usersById((await courseAssignments.find({ courseId: klass.courseId, removedAt: null }).toArray()).map((a) => a.instructorId));
  // Who taught this class and when: section assignments (current and earlier) and course assignments.
  const courseAssignHistory = await courseAssignments.find({ courseId: klass.courseId }).sort({ assignedAt: -1 }).toArray();
  const teachingHistory = [
    ...klass.instructors.map((i) => ({ instructorId: i.instructorId, scope: "This class", role: i.role, from: i.assignedAt, to: null as Date | null })),
    ...(klass.instructorHistory ?? []).map((i) => ({ instructorId: i.instructorId, scope: "This class", role: i.role, from: i.assignedAt, to: i.removedAt as Date | null })),
    ...courseAssignHistory.map((a) => ({ instructorId: a.instructorId, scope: "Whole course", role: "LEAD" as const, from: a.assignedAt, to: a.removedAt })),
  ].sort((a, b) => b.from.getTime() - a.from.getTime());
  const historyNames = await usersById(teachingHistory.map((h) => h.instructorId));
  const mergedInto = klass.mergedIntoClassId ? await classes.findOne({ _id: klass.mergedIntoClassId }, { projection: { code: 1 } }) : null;

  return (
    <>
      <Link href={`/admin/courses/${course._id}`} className="text-sm text-pine-700 underline">{course.name}</Link>
      <PageHeader title={`${klass.code}, ${klass.cohort}`}
        description={`${course.name}. ${fmtDate(klass.startDate)} to ${fmtDate(klass.endDate)}${klass.schedule ? `, ${klass.schedule}` : ""}`}
        actions={
          <>
            <a href={`/api/pdf/attendance/${klass._id}?from=${klass.startDate}&to=${today < klass.endDate ? today : klass.endDate}`} className="rounded-md border border-line bg-white px-4 py-2 text-sm font-semibold">Attendance sheet (PDF)</a>
            <a href={`/api/export/attendance?classId=${klass._id}`} className="rounded-md border border-line bg-white px-4 py-2 text-sm font-semibold">Export CSV</a>
          </>
        } />
      {mergedInto && <p className="mb-4 rounded-md bg-mist p-3 text-sm">This class was merged into <Link href={`/admin/classes/${klass.mergedIntoClassId}`} className="font-semibold underline">{mergedInto.code}</Link> on {fmtDate(klass.mergedAt)}. Its records are kept here.</p>}
      <div className="mb-6 flex flex-wrap gap-3">
        <Link href={`/admin/classes/${klass._id}/attendance`} className="rounded-md bg-pine-700 px-4 py-2 text-sm font-semibold text-white">Daily attendance</Link>
      </div>
      <div className="space-y-6">
        <Card title={`Roster (${activeIds.size}/${klass.capacity})`}>
          {roster.length === 0 ? <Empty>No students yet.</Empty> : (
            <Table head={["Student", "Program", "Status", "Attended", "Attendance sheet", `Report ${thisMonth}`, ""]}>
              {roster.map(({ enrollment, student, category }) => {
                const a = appsByStudent.get(student._id);
                const marks = sessions.map((s) => s.records[enrollment._id]).filter(Boolean);
                const attended = marks.filter((r) => r.status === "PRESENT" || r.status === "LATE").length;
                const rep = reports.find((r) => r.enrollmentId === enrollment._id);
                return (
                  <tr key={enrollment._id}>
                    <Td><Link href={`/admin/students/${student._id}`} className="font-semibold text-pine-700 underline">{student.name}</Link></Td>
                    <Td>{a ? describeEnrollment(a) : category ? CATEGORY_LABELS[category] : "-"}</Td>
                    <Td><StatusBadge status={enrollment.status} /></Td>
                    <Td className="tabular-nums">{attended}/{sessions.length}</Td>
                    <Td><Link href={`/admin/attendance/sheets/${enrollment._id}`} className="underline">{a?.category === "EQISS" ? "Biweekly report" : "Monthly sheet"}</Link></Td>
                    <Td>{rep ? <Link href={`/admin/reports/${rep._id}`} className="underline">{rep.status === "SUBMITTED" ? "Submitted" : "Draft"}</Link> : <span className="text-slate-500">Not started</span>}</Td>
                    <Td>{enrollment.status === "ACTIVE" && (
                      <details>
                        <summary className="cursor-pointer text-sm font-semibold text-pine-700">Move / withdraw</summary>
                        <div className="mt-3 w-64 space-y-4">
                          {moveTargets.length > 0 && <MoveStudentForm action={moveStudentAction} enrollmentId={enrollment._id} sections={moveTargets} />}
                          <ActionButton action={endEnrollmentAction} label="Withdraw" variant="ghost" hidden={{ enrollmentId: enrollment._id, status: "WITHDRAWN" }} confirm={`Withdraw ${student.name} from this class? Records are kept.`} />
                        </div>
                      </details>
                    )}</Td>
                  </tr>
                );
              })}
            </Table>
          )}
          {!klass.archived && assignable.length > 0 && (
            <div className="mt-5 border-t border-line pt-5">
              <h3 className="mb-3 text-sm font-semibold">Add an approved student</h3>
              <AssignStudentToThisClass classId={klass._id} students={assignable.map((s) => ({ id: s._id, label: `${s.name} (${s.email})` }))} />
            </div>
          )}
        </Card>
        <Card title="Instructors">
          <p className="mb-4 text-sm">Course instructors (teach every class of this course): {[...courseInstructors.values()].map((u) => u.name).join(", ") || <span className="text-marigold-700">none. <Link href={`/admin/courses/${course._id}`} className="underline">Assign on the course page</Link></span>}</p>
          <details className="rounded-md border border-line p-3">
          <summary className="cursor-pointer text-sm font-semibold">Extra instructors for this class only (optional)</summary>
          <div className="mt-3">
          {instructors.length === 0 ? <p className="mb-4 text-sm text-marigold-700">No instructor assigned.</p> : (
            <ul className="mb-5 divide-y divide-line">
              {instructors.map((i) => (
                <li key={i._id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span><Link href={`/admin/instructors/${i._id}`} className="font-semibold text-pine-700 underline">{i.name}</Link> ({i.role === "LEAD" ? "Lead" : "Assistant"})</span>
                  <ActionButton action={removeInstructorAction.bind(null, klass._id)} label="Remove" variant="ghost" hidden={{ instructorId: i._id }} confirm={`Remove ${i.name} from this class?`} />
                </li>
              ))}
            </ul>
          )}
          {approvedInstructors.length ? (
            <AssignInstructorForm action={assignInstructorAction.bind(null, klass._id)} instructors={approvedInstructors.map((i) => ({ id: i._id, label: `${i.name} (${i.email})` }))} />
          ) : (
            <p className="text-sm text-slate-600">No approved instructors yet. <Link href="/admin/instructors" className="underline">Review instructor sign-ups</Link>.</p>
          )}
          </div>
          </details>
        </Card>
        <Card title="Instructor history">
          {teachingHistory.length === 0 ? <Empty>No instructor has been assigned yet.</Empty> : (
            <Table head={["Instructor", "Assigned to", "Started", "Stopped"]}>
              {teachingHistory.map((h, i) => (
                <tr key={i}>
                  <Td><Link href={`/admin/instructors/${h.instructorId}`} className="underline">{historyNames.get(h.instructorId)?.name ?? "Instructor"}</Link>{h.scope === "This class" && h.role === "ASSISTANT" ? " (assistant)" : ""}</Td>
                  <Td>{h.scope}</Td>
                  <Td>{fmtDate(h.from)}</Td>
                  <Td>{h.to ? fmtDate(h.to) : <span className="font-semibold text-pine-700">Current</span>}</Td>
                </tr>
              ))}
            </Table>
          )}
          <p className="mt-3 text-xs text-slate-500">Attendance and reports an instructor wrote stay on record after they stop teaching the class.</p>
        </Card>
        <details className="rounded-lg border border-line bg-white p-5">
          <summary className="cursor-pointer font-semibold">Class times, late rule and check-in</summary>
          <div className="mt-4">
          <ClassSettingsForm studentCount={activeIds.size} save={saveClassSettingsAction.bind(null, klass._id)} sendLink={sendClassroomLinkAction.bind(null, klass._id)}
            settings={{
              classroomUrl: klass.classroomUrl ?? "", classroomSentAt: klass.classroomSentAt ? `${localDateOf(klass.classroomSentAt)} ${timeLocal(klass.classroomSentAt)}` : null,
              sessionStart: klass.sessionStart ?? "", sessionEnd: klass.sessionEnd ?? "", breakStart: klass.breakStart ?? "", breakEnd: klass.breakEnd ?? "",
              checkInEnabled: !!klass.checkInEnabled, lateAfterMinutes: klass.lateAfterMinutes ?? null,
            }} />
        </div>
        </details>
        <details className="rounded-lg border border-line bg-white p-5">
          <summary className="cursor-pointer font-semibold">Advanced: edit class dates, merge classes, archive</summary>
          <div className="mt-4 space-y-6">
        {!klass.archived && mergeable.length > 0 && (
          <Card title="Merge other classes into this one"><MergeSectionsForm action={mergeSectionsAction.bind(null, klass._id)} sections={mergeable} /></Card>
        )}
        <Card title="Class details" actions={<ActionButton action={archiveClassAction.bind(null, klass._id)} label={klass.archived ? "Restore" : "Archive"} variant="ghost" confirm={klass.archived ? undefined : "Archive this class? Its records are kept."} />}>
          <ClassForm action={saveClassAction.bind(null, course._id, klass._id)} values={klass} submitLabel="Save class" />
        </Card>
          </div>
        </details>
      </div>
    </>
  );
}
