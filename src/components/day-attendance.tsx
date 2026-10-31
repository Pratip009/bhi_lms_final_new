import Link from "next/link";
import { cols, type Klass, type User } from "@/db";
import { timeLocalExact, todayLocal } from "@/lib/dates";
import { editLockDays } from "@/lib/attendance-rules";
import { rosterOn } from "@/lib/live";
import { saveDayAction } from "@/lib/actions/daily";
import { startCheckInAction, closeCheckInAction, completeDayAction, signDayAction } from "@/lib/actions/checkin";
import { LiveDayBoard } from "@/components/live-day-board";
import { Empty } from "@/components/ui";
import { AttendanceForm, type DayRow } from "@/app/instructor/(portal)/classes/[id]/attendance/attendance-form";

/**
 * One class day, for instructors and admins: pick the date, mark each student (with time in and out),
 * then sign the day. When the class uses check-in codes, the live check-in panel appears too.
 */
export async function DayAttendance({ klass, viewer, basePath, requestedDate }: { klass: Klass; viewer: User; basePath: string; requestedDate?: string }) {
  const today = todayLocal();
  const maxDate = today < klass.endDate ? today : klass.endDate;
  const lock = viewer.role === "ADMIN" ? 0 : editLockDays();
  const lockFrom = lock ? todayLocal(new Date(Date.now() - lock * 86_400_000)) : "";
  const minDate = lockFrom > klass.startDate ? lockFrom : klass.startDate;
  const asked = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate ?? "") ? requestedDate! : maxDate;
  const date = asked > maxDate ? maxDate : asked < klass.startDate ? klass.startDate : asked;
  const roster = await rosterOn(klass._id, date);
  const { classSessions, checkIns } = await cols();
  const [session, ci] = await Promise.all([classSessions.findOne({ classId: klass._id, date }), checkIns.findOne({ classId: klass._id, date })]);
  const notStarted = today < klass.startDate;

  const rows: DayRow[] = roster.map(({ enrollment, student }) => {
    const r = session?.records[enrollment._id];
    const c = ci?.entries[enrollment._id];
    return {
      enrollmentId: enrollment._id, name: student.name, status: r?.status, timeIn: r?.startTime ?? "", timeOut: r?.endTime ?? "", note: r?.note ?? "",
      hours: r ? Number(r.hours) || 0 : undefined, left: enrollment.status !== "ACTIVE",
      checkedIn: c ? { time: timeLocalExact(c.at), late: c.status === "LATE", sameAs: [] } : undefined,
    };
  });

  return (
    <div className="space-y-6">
      <form className="flex flex-wrap items-center gap-2 text-sm">
        <label htmlFor="date" className="font-medium">Date</label>
        <input id="date" type="date" name="date" defaultValue={date} min={minDate} max={maxDate} className="rounded-md border border-line px-2 py-1.5" />
        <button className="rounded-md border border-line bg-white px-3 py-1.5 font-semibold">Show this date</button>
        {date !== maxDate && <Link href={basePath} className="ml-2 text-pine-700 underline">Back to today</Link>}
      </form>
      {notStarted ? <Empty>This class hasn&apos;t started yet.</Empty> : roster.length === 0 ? <Empty>No students in this class on this date.</Empty> : (
        <>
          {klass.checkInEnabled && (
            <LiveDayBoard key={`live:${date}`} classId={klass._id} date={date} canSign={false} viewerName={viewer.name} checkInEnabled
              start={startCheckInAction.bind(null, klass._id)} close={closeCheckInAction.bind(null, klass._id)}
              complete={completeDayAction.bind(null, klass._id, date)} sign={signDayAction.bind(null, klass._id, date)} />
          )}
          <section>
            <h2 className="mb-3 text-lg font-semibold">1. Mark attendance</h2>
            <AttendanceForm key={`${date}:${session?.records ? Object.keys(session.records).length : 0}`} action={saveDayAction.bind(null, klass._id)} date={date} rows={rows}
              start={klass.sessionStart ?? ""} end={klass.sessionEnd ?? ""} />
          </section>
          <section>
            <h2 className="mb-3 text-lg font-semibold">2. Sign the day</h2>
            <LiveDayBoard key={`sign:${date}`} classId={klass._id} date={date} canSign viewerName={viewer.name} checkInEnabled={false}
              start={startCheckInAction.bind(null, klass._id)} close={closeCheckInAction.bind(null, klass._id)}
              complete={completeDayAction.bind(null, klass._id, date)} sign={signDayAction.bind(null, klass._id, date)} />
          </section>
        </>
      )}
    </div>
  );
}
