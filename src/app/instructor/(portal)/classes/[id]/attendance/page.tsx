import Link from "next/link";
import { notFound } from "next/navigation";
import { cols } from "@/db";
import { requireInstructor } from "@/lib/auth";
import { instructorTeachesClass } from "@/lib/authz";
import { getClassWithCourse, rosterForClass } from "@/lib/queries";
import { Alert, Empty, PageHeader } from "@/components/ui";
import { AttendanceForm } from "./attendance-form";
import { recordAttendanceAction } from "@/app/instructor/actions";
import { todayLocal, timeLocal } from "@/lib/dates";
import { isOpen, sharedDevices, unconfirmed } from "@/lib/checkin";
import { startCheckInAction, closeCheckInAction } from "@/lib/actions/checkin";
import { CheckInPanel } from "@/components/checkin-panel";
import { editLockDays } from "@/lib/attendance-rules";

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
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") ? sp.date! : maxDate;
  const roster = (await rosterForClass(id)).filter((r) => r.enrollment.status === "ACTIVE");
  const { classSessions, checkIns } = await cols();
  const session = await classSessions.findOne({ classId: id, date });
  const checkIn = await checkIns.findOne({ classId: id, date });
  const entries = checkIn?.entries ?? {};
  const shared = sharedDevices(entries);
  const checkInClosed = !!checkIn && !isOpen(checkIn);
  const nameByEnrollment = new Map(roster.map((r) => [r.enrollment._id, r.student.name]));
  // Students who checked in but the saved sheet doesn't count them yet (not saved, or saved as absent).
  const needsReview = session ? unconfirmed(entries, session.records).filter((eid) => nameByEnrollment.has(eid)) : [];
  const runsToday = date === today && !row.klass.archived && today >= row.klass.startDate && today <= row.klass.endDate;

  return (
    <>
      <Link href={`/instructor/classes/${id}`} className="text-sm text-pine-700 underline">{row.course.name}: {row.klass.code}</Link>
      <PageHeader title="Take attendance" description={session ? "Attendance already exists for this date. Saving updates it." : "Mark each student, then save."} />
      <form className="mb-5 flex items-center gap-2 text-sm">
        <label htmlFor="date">Date</label>
        <input id="date" type="date" name="date" defaultValue={date} min={minDate} max={maxDate} className="rounded-md border border-line px-2 py-1.5" />
        <button className="rounded-md border border-line bg-white px-3 py-1.5 font-semibold">Change date</button>
      </form>
      {runsToday && roster.length > 0 && (
        <CheckInPanel classId={id} start={startCheckInAction.bind(null, id)} close={closeCheckInAction.bind(null, id)} />
      )}
      {needsReview.length > 0 && (
        <div className="mb-4"><Alert tone="warning">
          Checked in but not counted on the saved sheet: {needsReview.map((e) => nameByEnrollment.get(e)).join(", ")}. Confirm or correct their marks and save.
        </Alert></div>
      )}
      {checkIn && !checkInClosed && Object.keys(entries).length > 0 && (
        <p className="mb-3 text-sm text-slate-600">Check-in is still open. Close it when everyone has arrived; anyone who hasn't checked in will then be pre-marked absent below.</p>
      )}
      {roster.length === 0 ? <Empty>No students in this class.</Empty> : (
        <AttendanceForm key={`${date}:${Object.keys(entries).length}:${checkInClosed}`} action={recordAttendanceAction.bind(null, id)} date={date} defaultHours={4}
          rows={roster.map(({ enrollment, student }) => {
            const r = session?.records[enrollment._id];
            const e = entries[enrollment._id];
            const sameAs = (shared.get(enrollment._id) ?? []).map((x) => nameByEnrollment.get(x) ?? "another student");
            // Saved marks always win. Otherwise pre-fill from check-in; after check-in closes, no check-in means absent.
            const status = r?.status ?? e?.status ?? (checkInClosed ? "ABSENT" : undefined);
            const note = r?.note ?? (e ? `Checked in ${timeLocal(e.at)}${sameAs.length ? `; same phone as ${sameAs.join(", ")}` : ""}` : checkInClosed ? "Did not check in" : "");
            return { enrollmentId: enrollment._id, name: student.name, status, hours: r ? String(r.hours) : status === "ABSENT" ? "0" : undefined, note, checkedIn: e ? { time: timeLocal(e.at), late: e.status === "LATE", sameAs } : undefined };
          })} />
      )}
    </>
  );
}
