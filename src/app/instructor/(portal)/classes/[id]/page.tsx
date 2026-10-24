import Link from "next/link";
import { notFound } from "next/navigation";
import { cols } from "@/db";
import { requireInstructor } from "@/lib/auth";
import { instructorTeachesClass } from "@/lib/authz";
import { getClassWithCourse, rosterForClass, unconfirmedCheckIns } from "@/lib/queries";
import { Alert, Badge, Empty, LinkButton, PageHeader, Table, Td, fmtDate } from "@/components/ui";
import { todayLocal, thisMonthLocal } from "@/lib/dates";

export default async function InstructorClass({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ month?: string }> }) {
  const user = await requireInstructor();
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id) || !(await instructorTeachesClass(user._id, id))) notFound();
  const row = await getClassWithCourse(id);
  if (!row) notFound();
  const currentMonth = thisMonthLocal();
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") && sp.month! <= currentMonth ? sp.month! : currentMonth;
  const roster = (await rosterForClass(id)).filter((r) => r.enrollment.status === "ACTIVE");
  const { classSessions, progressReports } = await cols();
  const sessions = await classSessions.find({ classId: id }).toArray();
  const reports = await progressReports.find({ enrollmentId: { $in: roster.map((r) => r.enrollment._id) }, month }, { projection: { data: 0 } }).toArray();
  const today = todayLocal();
  const { klass, course } = row;
  const toConfirm = await unconfirmedCheckIns([id]);

  return (
    <>
      <Link href="/instructor" className="text-sm text-pine-700 underline">My classes</Link>
      <PageHeader title={`${course.name}: ${klass.code}`} description={`${klass.cohort}. ${fmtDate(klass.startDate)} to ${fmtDate(klass.endDate)}. ${sessions.length} sessions recorded.`}
        actions={
          <>
            <LinkButton href={`/instructor/classes/${id}/attendance`}>Check-in and attendance</LinkButton>
            <a href={`/api/pdf/attendance/${id}?from=${klass.startDate}&to=${today < klass.endDate ? today : klass.endDate}`} className="rounded-md border border-line bg-white px-4 py-2 text-sm font-semibold">Class attendance (PDF)</a>
          </>
        } />
      {toConfirm.length > 0 && (
        <div className="mb-4"><Alert tone="warning">
          Check-ins to confirm: {toConfirm.map((t, i) => (
            <span key={t.date}>{i > 0 && ", "}<Link href={`/instructor/classes/${id}/attendance?date=${t.date}`} className="underline">{fmtDate(t.date)} ({t.count})</Link></span>
          ))}
        </Alert></div>
      )}
      <form className="mb-4 flex items-center gap-2 text-sm">
        <label htmlFor="month">Progress reports for</label>
        <input id="month" type="month" name="month" defaultValue={month} max={currentMonth} className="rounded-md border border-line px-2 py-1" />
        <button className="rounded-md border border-line bg-white px-3 py-1 font-semibold">Show</button>
      </form>
      {roster.length === 0 ? <Empty>No students in this class yet.</Empty> : (
        <Table head={["Student", "Attended", "Hours", "Attendance sheet", `Report ${month}`]}>
          {roster.map(({ enrollment, student, category }) => {
            const marks = sessions.map((s) => s.records[enrollment._id]).filter(Boolean);
            const attended = marks.filter((r) => r.status === "PRESENT" || r.status === "LATE").length;
            const hours = marks.reduce((s, r) => s + r.hours, 0);
            const rep = reports.find((r) => r.enrollmentId === enrollment._id);
            return (
              <tr key={enrollment._id}>
                <Td className="font-semibold">{student.name}</Td>
                <Td className="tabular-nums">{attended}/{sessions.length}</Td>
                <Td className="tabular-nums">{hours.toFixed(1)}</Td>
                <Td><Link href={`/instructor/attendance/${enrollment._id}`} className="text-pine-700 underline">{category === "EQISS" ? "Biweekly report" : "Monthly sheet"}</Link></Td>
                <Td>
                  <Link href={`/instructor/reports/${enrollment._id}/${month}`} className="inline-flex items-center gap-2 text-pine-700 underline">
                    {rep?.status === "SUBMITTED" ? <Badge tone="pine">Submitted</Badge> : rep ? <Badge tone="marigold">Draft</Badge> : <Badge tone="brick">Not started</Badge>}
                    {rep?.status === "SUBMITTED" ? "View" : "Fill in"}
                  </Link>
                </Td>
              </tr>
            );
          })}
        </Table>
      )}
    </>
  );
}
