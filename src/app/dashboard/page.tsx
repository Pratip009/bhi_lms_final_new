import type { Metadata } from "next";
import Link from "next/link";
import { cols } from "@/db";
import { requireStudentStage } from "@/lib/auth";
import { classesForStudent, coursesById, instructorsForClasses } from "@/lib/queries";
import { attendanceFormatFor, describeEnrollment } from "@/lib/forms/templates";
import { CheckInBox } from "@/components/checkin-box";
import { checkInAction, fillMyAttendanceAction } from "@/lib/actions/checkin";
import { todayLocal } from "@/lib/dates";
import { StudentShell } from "@/components/student-shell";
import { Card, PageHeader, StatusBadge, fmtDate } from "@/components/ui";

export const metadata: Metadata = { title: "My dashboard" };
export const dynamic = "force-dynamic";

export default async function StudentDashboard() {
  const { user, application } = await requireStudentStage("DASHBOARD");
  const rows = await classesForStudent(user._id);
  const instructors = await instructorsForClasses(rows.map((r) => r.klass));
  const today = todayLocal();
  const { enrollments, classes, courseAssignments } = await cols();
  const format = attendanceFormatFor(application.category);
  // Course instructors (assigned to the whole course) as well as any assigned to the section.
  const courseTeachers = await courseAssignments.find({ courseId: { $in: rows.map((r) => r.course._id) }, removedAt: null }).toArray();
  const teacherNames = new Map((await (await cols()).users.find({ _id: { $in: courseTeachers.map((a) => a.instructorId) } }, { projection: { name: 1 } }).toArray()).map((u) => [u._id, u.name]));
  // Earlier sections (moves, merges, completed courses): history stays visible to the student.
  const past = await enrollments.find({ studentId: user._id, status: { $ne: "ACTIVE" } }).sort({ endedAt: -1 }).toArray();
  const pastClasses = await classes.find({ _id: { $in: past.map((e) => e.classId) } }).toArray();
  const pastCourses = await coursesById(pastClasses.map((k) => k.courseId));

  return (
    <StudentShell name={user.name} step={4}>
      <PageHeader title={`Welcome, ${user.name.split(" ")[0]}`} description="Your courses, class information and attendance." />
      <Card title="My information" className="mb-6">
        <dl className="grid gap-3 text-sm sm:grid-cols-4">
          <div><dt className="text-slate-500">Name</dt><dd className="font-medium">{user.name}</dd></div>
          <div><dt className="text-slate-500">Email</dt><dd className="font-medium">{user.email}</dd></div>
          <div><dt className="text-slate-500">Enrollment</dt><dd className="font-medium">{describeEnrollment(application)}</dd></div>
          <div><dt className="text-slate-500">Application</dt><dd><StatusBadge status={application.status} /></dd></div>
        </dl>
        <p className="mt-3 text-xs text-slate-500">Your Google Classroom link is on each class below once your instructor shares it.</p>
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        {rows.map(({ klass, course, enrollment }) => {
          const runsToday = !klass.archived && today >= klass.startDate && today <= klass.endDate;
          const names = [
            ...instructors.filter((i) => i.classId === klass._id).map((i) => i.name),
            ...courseTeachers.filter((a) => a.courseId === course._id).map((a) => teacherNames.get(a.instructorId)).filter((n): n is string => !!n),
          ];
          return (
            <div key={klass._id} className="rounded-lg border border-line bg-white p-5">
              <p className="text-sm text-slate-500">Section {klass.code} · {klass.cohort}</p>
              <h2 className="mt-1 text-lg font-semibold">{course.name}</h2>
              <p className="mt-2 text-sm">{fmtDate(klass.startDate)} to {fmtDate(klass.endDate)}</p>
              {klass.schedule && <p className="text-sm text-slate-600">{klass.schedule}{klass.location ? `, ${klass.location}` : ""}</p>}
              <p className="mt-3 text-sm text-slate-600">Instructor: {[...new Set(names)].join(", ") || "To be assigned"}</p>
              {klass.classroomUrl ? (
                <a href={klass.classroomUrl} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-2 rounded-md bg-pine-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-pine-800">Open Google Classroom ↗</a>
              ) : <p className="mt-3 text-xs text-slate-500">Google Classroom link not shared yet.</p>}
              {runsToday && <div className="mt-4"><CheckInBox classId={klass._id} checkIn={checkInAction.bind(null, klass._id)} fill={fillMyAttendanceAction.bind(null, klass._id)} /></div>}
              <div className="mt-4 flex flex-wrap gap-4 text-sm font-semibold">
                <Link href={`/dashboard/attendance/${enrollment._id}`} className="text-pine-700 underline">
                  {format === "BIWEEKLY" ? "Biweekly attendance report" : "Monthly attendance sheet"}
                </Link>
                <Link href={`/dashboard/classes/${klass._id}`} className="text-pine-700 underline">Attendance history</Link>
              </div>
            </div>
          );
        })}
      </div>
      {past.length > 0 && (
        <Card title="Earlier sections" className="mt-6">
          <ul className="space-y-2 text-sm">
            {past.map((e) => {
              const k = pastClasses.find((x) => x._id === e.classId);
              return (
                <li key={e._id}>
                  {k ? `${pastCourses.get(k.courseId)?.name ?? ""}: ${k.code}` : "Section"} · <StatusBadge status={e.status} /> {fmtDate(e.endedAt)}{" "}
                  <Link href={`/dashboard/attendance/${e._id}`} className="text-pine-700 underline">Attendance</Link>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
      <p className="mt-8 text-sm"><a href={`/api/pdf/application/${application._id}`} className="text-pine-700 underline">Download my application (PDF)</a></p>
    </StudentShell>
  );
}
