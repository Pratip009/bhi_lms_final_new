import { notFound } from "next/navigation";
import Link from "next/link";
import { cols } from "@/db";
import { requireStudentStage } from "@/lib/auth";
import { attendanceForEnrollment, getClassWithCourse, studentCheckIns } from "@/lib/queries";
import { CheckInBox } from "@/components/checkin-box";
import { checkInAction } from "@/lib/actions/checkin";
import { StudentShell } from "@/components/student-shell";
import { AttendanceTable } from "@/components/attendance-table";
import { PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function StudentClassPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user } = await requireStudentStage("DASHBOARD");
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  // Only the student's own enrollment is ever loaded.
  const enrollment = await (await cols()).enrollments.findOne({ classId: id, studentId: user._id, status: "ACTIVE" });
  if (!enrollment) notFound();
  const row = await getClassWithCourse(id);
  if (!row) notFound();
  const attendance = await attendanceForEnrollment(enrollment);
  const ci = (await studentCheckIns(user._id)).get(id);
  return (
    <StudentShell name={user.name} step={4}>
      <Link href="/dashboard" className="text-sm text-pine-700 underline">My classes</Link>
      <PageHeader title={row.course.name} description={`${row.klass.code}, ${row.klass.cohort}${row.klass.schedule ? `, ${row.klass.schedule}` : ""}`} />
      {ci && (ci.open || ci.checkedIn) && <div className="mb-6"><CheckInBox state={ci} action={checkInAction.bind(null, id)} /></div>}
      <h2 className="mb-3 font-semibold">My attendance</h2>
      <AttendanceTable rows={attendance} />
    </StudentShell>
  );
}
