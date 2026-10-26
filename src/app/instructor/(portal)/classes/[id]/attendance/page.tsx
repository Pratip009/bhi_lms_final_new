import Link from "next/link";
import { notFound } from "next/navigation";
import { cols } from "@/db";
import { requireInstructor } from "@/lib/auth";
import { instructorTeachesClass } from "@/lib/authz";
import { getClassWithCourse } from "@/lib/queries";
import { Empty, PageHeader } from "@/components/ui";
import { AttendanceForm } from "./attendance-form";
import { recordAttendanceAction } from "@/app/instructor/actions";
import { todayLocal } from "@/lib/dates";
import { startCheckInAction, closeCheckInAction, completeDayAction, signDayAction } from "@/lib/actions/checkin";
import { LiveDayBoard } from "@/components/live-day-board";
import { editLockDays } from "@/lib/attendance-rules";
import { rosterOn } from "@/lib/live";

export const dynamic = "force-dynamic";

export default async function TakeAttendance({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ date?: string }> }) {
  const user = await requireInstructor();
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id) || !(await instructorTeachesClass(user._id, id))) notFound();
  const row = await getClassWithCourse(id);
  if (!row) notFound();
  const today = todayLocal();
  const maxDate = today < row.klass.endDate ? today : row.klass.endDate;
  const lock = editLockDays();
  const lockFrom = lock ? todayLocal(new Date(Date.now() - lock * 86_400_000)) : "";
  const minDate = lockFrom > row.klass.startDate ? lockFrom : row.klass.startDate;
  const asked = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") ? sp.date! : maxDate;
  const date = asked > maxDate ? maxDate : asked < row.klass.startDate ? row.klass.startDate : asked;
  const roster = await rosterOn(id, date);
  const session = await (await cols()).classSessions.findOne({ classId: id, date });

  return (
    <>
      <Link href={`/instructor/classes/${id}`} className="text-sm text-pine-700 underline">{row.course.name}: {row.klass.code}</Link>
      <PageHeader title="Check-in and attendance"
        description="Generate a 10-minute code when class starts. Students check in, then press “Fill my attendance” at the end of class. Review the live sheet and sign it each day." />
      <form className="mb-5 flex items-center gap-2 text-sm">
        <label htmlFor="date">Date</label>
        <input id="date" type="date" name="date" defaultValue={date} min={minDate} max={maxDate} className="rounded-md border border-line px-2 py-1.5" />
        <button className="rounded-md border border-line bg-white px-3 py-1.5 font-semibold">Change date</button>
        {date !== today && <Link href={`/instructor/classes/${id}/attendance`} className="ml-2 text-pine-700 underline">Back to today</Link>}
      </form>

      <LiveDayBoard key={date} classId={id} date={date} canSign viewerName={user.name}
        start={startCheckInAction.bind(null, id)} close={closeCheckInAction.bind(null, id)}
        complete={completeDayAction.bind(null, id, date)} sign={signDayAction.bind(null, id, date)} />

      <details className="rounded-lg border border-line bg-white p-5">
        <summary className="cursor-pointer font-semibold">Correct marks by hand</summary>
        <p className="mb-4 mt-2 text-sm text-slate-600">
          For excused absences, holidays or mistakes. Only rows you change are saved, so students who are still in class can fill out their day.
          Times can be corrected on each student&apos;s monthly sheet. Changing a signed day means signing it again.
        </p>
        {roster.length === 0 ? <Empty>No students on this date.</Empty> : (
          <AttendanceForm key={`${date}:${session?.records ? Object.keys(session.records).length : 0}`} action={recordAttendanceAction.bind(null, id)} date={date} defaultHours={0}
            rows={roster.map(({ enrollment, student }) => {
              const r = session?.records[enrollment._id];
              return { enrollmentId: enrollment._id, name: student.name, status: r?.status, hours: r ? String(r.hours) : undefined, note: r?.note ?? "" };
            })} />
        )}
      </details>
    </>
  );
}
