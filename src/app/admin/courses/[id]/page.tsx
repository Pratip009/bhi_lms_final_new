import Link from "next/link";
import { notFound } from "next/navigation";
import { cols } from "@/db";
import { requireAdmin } from "@/lib/auth";
import { activeCountsByClass, usersById } from "@/lib/queries";
import { ActionButton, ClassForm, CourseForm } from "@/components/action-widgets";
import { CourseInstructorForm } from "@/components/admin-app-edit";
import { Badge, Card, Empty, PageHeader, Table, Td, fmtDate } from "@/components/ui";
import { archiveCourseAction, assignInstructorToCourseAction, removeCourseAssignmentAction, saveClassAction, saveCourseAction } from "../../actions";

export default async function CoursePage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const { courses, classes, courseAssignments, users, enrollments } = await cols();
  const course = await courses.findOne({ _id: id });
  if (!course) notFound();
  const list = await classes.find({ courseId: id }).sort({ archived: 1, startDate: 1 }).toArray();
  const counts = await activeCountsByClass();
  const assignments = await courseAssignments.find({ courseId: id }).sort({ assignedAt: -1 }).toArray();
  const active = assignments.filter((a) => !a.removedAt);
  const people = await usersById([...list.flatMap((k) => k.instructors.map((i) => i.instructorId)), ...assignments.map((a) => a.instructorId)]);
  const approved = await users.find({ role: "INSTRUCTOR", instructorStatus: "APPROVED", disabledAt: null }, { projection: { _id: 1, name: 1, email: 1 } }).sort({ name: 1 }).toArray();
  const candidates = approved.filter((u) => !active.some((a) => a.instructorId === u._id)).map((u) => ({ id: u._id, label: `${u.name} (${u.email})` }));
  const activeStudents = await enrollments.countDocuments({ classId: { $in: list.map((k) => k._id) }, status: "ACTIVE" });

  return (
    <>
      <Link href="/admin/courses" className="text-sm text-pine-700 underline">Courses and classes</Link>
      <PageHeader title={course.name} description={course.description || undefined}
        actions={<ActionButton action={archiveCourseAction.bind(null, course._id)} label={course.archived ? "Restore course" : "Archive course"} variant="secondary"
          confirm={course.archived ? undefined : "Archive this course? It stops appearing in class pickers; records are kept."} />} />
      <div className="space-y-6">
        <Card title={`Instructors (${active.length})`}>
          {active.length === 0 ? <p className="mb-4 text-sm text-marigold-700">No instructor assigned to this course.</p> : (
            <ul className="mb-4 divide-y divide-line">
              {active.map((a) => (
                <li key={a._id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <Link href={`/admin/instructors/${a.instructorId}`} className="font-semibold text-pine-700 underline">{people.get(a.instructorId)?.name ?? "Instructor"}</Link>
                  <ActionButton action={removeCourseAssignmentAction} label="Remove" variant="ghost" hidden={{ assignmentId: a._id }} confirm="Remove this instructor from the course? Records they wrote are kept." />
                </li>
              ))}
            </ul>
          )}
          {!course.archived && candidates.length > 0 && <CourseInstructorForm action={assignInstructorToCourseAction.bind(null, course._id)} instructors={candidates} />}
          {assignments.some((a) => a.removedAt) && (
            <p className="mt-4 text-xs text-slate-500">Earlier instructors: {assignments.filter((a) => a.removedAt).map((a) => `${people.get(a.instructorId)?.name ?? "?"} (${fmtDate(a.assignedAt)} to ${fmtDate(a.removedAt)})`).join("; ")}</p>
          )}
          <p className="mt-4 text-sm"><Link href={`/admin/students?course=${course._id}`} className="text-pine-700 underline">Student list for this course ({activeStudents} active)</Link></p>
        </Card>
        <Card title="Sections (classes)">
          {list.length === 0 ? (
            <Empty>No classes yet. Create the first class below.</Empty>
          ) : (
            <Table head={["Section", "Cohort", "Dates", "Section instructors", "Students", ""]}>
              {list.map((k) => (
                <tr key={k._id} className={k.archived ? "opacity-60" : undefined}>
                  <Td><Link href={`/admin/classes/${k._id}`} className="font-semibold text-pine-700 underline">{k.code}</Link>{k.archived && <span className="ml-2"><Badge>{k.mergedIntoClassId ? "Merged" : "Archived"}</Badge></span>}</Td>
                  <Td>{k.cohort}</Td>
                  <Td>{fmtDate(k.startDate)} to {fmtDate(k.endDate)}</Td>
                  <Td>{k.instructors.map((i) => people.get(i.instructorId)?.name).filter(Boolean).join(", ") || <span className="text-slate-500">Course instructors</span>}</Td>
                  <Td className="tabular-nums">{counts.get(k._id) ?? 0}/{k.capacity}</Td>
                  <Td><Link href={`/admin/classes/${k._id}`} className="text-pine-700 underline">Open</Link></Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
        {!course.archived && <Card title="Create a section"><ClassForm action={saveClassAction.bind(null, course._id, null)} submitLabel="Create class" /></Card>}
        <Card title="Course details">
          <CourseForm action={saveCourseAction.bind(null, course._id)} values={course} submitLabel="Save course" />
        </Card>
      </div>
    </>
  );
}
