import "server-only";
import { cols, type AttendanceRecord, type Klass } from "@/db";
import { env } from "@/lib/env";
import { getClassWithCourse, rosterForClass, usersById } from "@/lib/queries";
import { enrolledOn } from "@/lib/attendance-rules";
import { localDateOf, timeLocal, timeLocalExact, todayLocal } from "@/lib/dates";
import { codeFor, isOpen, sharedDevices } from "@/lib/checkin";
import { dailyRecordsHash, dayCounts, hoursFromMinutes, isPendingFill, minutesOf, type DaySchedule } from "@/lib/attendance-math";

export const scheduleOf = (k: Klass): DaySchedule => ({
  sessionStart: k.sessionStart ?? null, sessionEnd: k.sessionEnd ?? null, breakStart: k.breakStart ?? null, breakEnd: k.breakEnd ?? null,
});

/** Students who belong on a class's sheet for a date: enrolled on or before it, and not gone before it. */
export async function rosterOn(classId: string, date: string) {
  return (await rosterForClass(classId)).filter((r) => localDateOf(r.enrollment.assignedAt) <= date && enrolledOn(r.enrollment, date));
}

export type RowState = "NOT_CHECKED_IN" | "CHECKED_IN" | "FILLED" | "FILLED_BY_INSTRUCTOR" | "ABSENT" | "MARKED";
export type BoardRow = {
  enrollmentId: string;
  name: string;
  state: RowState;
  checkIn: { time: string; late: boolean; round: number } | null;
  record: {
    status: AttendanceRecord["status"]; startTime: string; lunchOut: string; lunchIn: string; endTime: string;
    hours: number; minutes: number; note: string; source: string; filledAt: string | null;
  } | null;
  attention: string | null;
};
export type Board = NonNullable<Awaited<ReturnType<typeof loadDayBoard>>>;

/**
 * Everything the live attendance board shows for one class and date. The check-in code is only
 * included when asked for (staff), for today, while it is valid.
 */
export async function loadDayBoard(classId: string, date: string, opts: { includeCode: boolean }) {
  const row = await getClassWithCourse(classId);
  if (!row) return null;
  const { klass, course } = row;
  const { classSessions, checkIns } = await cols();
  const now = new Date();
  const today = todayLocal(now);
  const [roster, session, ci] = await Promise.all([
    rosterOn(classId, date),
    classSessions.findOne({ classId, date }),
    checkIns.findOne({ classId, date }),
  ]);
  const ids = roster.map((r) => r.enrollment._id);
  const names = new Map(roster.map((r) => [r.enrollment._id, r.student.name]));
  const shared = ci ? sharedDevices(ci.entries) : new Map<string, string[]>();

  const rows: BoardRow[] = roster.map(({ enrollment, student }) => {
    const id = enrollment._id;
    const r = session?.records[id];
    const e = ci?.entries[id];
    const state: RowState = !r
      ? e ? "CHECKED_IN" : "NOT_CHECKED_IN"
      : isPendingFill(r) ? "CHECKED_IN"
        : r.source === "STUDENT_FILL" ? "FILLED"
          : r.source === "INSTRUCTOR_FILL" ? "FILLED_BY_INSTRUCTOR"
            : r.status === "ABSENT" ? "ABSENT" : "MARKED";
    const sameAs = (shared.get(id) ?? []).map((x) => names.get(x) ?? "another student");
    let attention: string | null = null;
    if (e && r?.status === "ABSENT") attention = "Checked in, but marked absent";
    else if (e && !r) attention = "Checked in, but no sheet entry";
    else if (sameAs.length) attention = `Same phone as ${sameAs.join(", ")}`;
    return {
      enrollmentId: id,
      name: student.name,
      state,
      checkIn: e ? { time: timeLocalExact(e.at), late: e.status === "LATE", round: e.round ?? 1 } : null,
      record: r ? {
        status: r.status, startTime: r.startTime ?? "", lunchOut: r.lunchOut ?? "", lunchIn: r.lunchIn ?? "", endTime: r.endTime ?? "",
        hours: Number(r.hours) || 0, minutes: minutesOf(r), note: r.note ?? "", source: r.source ?? "INSTRUCTOR",
        filledAt: r.studentFilledAt ? timeLocalExact(r.studentFilledAt) : r.checkOutAt ? timeLocalExact(r.checkOutAt) : null,
      } : null,
      attention,
    };
  });

  const counts = dayCounts(session?.records, ids);
  const hash = dailyRecordsHash(session?.records, ids);
  const open = !!ci && isOpen(ci, now);
  const unmarked = rows.filter((r) => !r.record).length;
  const pending = rows.filter((r) => r.state === "CHECKED_IN").length;
  const blockers: string[] = [];
  if (date > today) blockers.push("This date is in the future.");
  if (open && date === today) blockers.push("Check-in is still open. Close it first.");
  if (pending) blockers.push(`${pending} student${pending === 1 ? " has" : "s have"} checked in but not filled out the day.`);
  if (unmarked) blockers.push(`${unmarked} student${unmarked === 1 ? " has" : "s have"} no mark yet.`);
  if (!ids.length) blockers.push("No students were enrolled on this date.");

  const signoff = session?.signoff
    ? {
        signerName: session.signoff.signature.signerName,
        signedAt: `${localDateOf(session.signoff.signature.signedAt)} ${timeLocal(session.signoff.signature.signedAt)}`,
        imageDataUrl: session.signoff.signature.imageDataUrl,
        current: session.signoff.recordsHash === hash,
        history: (session.signoffHistory ?? []).length,
      }
    : null;

  return {
    classId, date, today: date === today, serverNow: now.getTime(),
    className: `${course.name}: ${klass.code}`,
    running: !klass.archived && today >= klass.startDate && today <= klass.endDate,
    schedule: scheduleOf(klass),
    checkIn: {
      exists: !!ci,
      open,
      code: opts.includeCode && open && date === today ? codeFor(env().SESSION_SECRET, ci!) : null,
      expiresAt: open ? ci!.expiresAt.getTime() : null,
      rounds: ci?.rounds?.length ?? (ci ? 1 : 0),
      firstOpenedAt: ci ? timeLocalExact(ci.openedAt) : null,
      onTimeUntil: ci ? timeLocalExact(new Date(ci.openedAt.getTime() + ci.lateAfterMinutes * 60_000)) : null,
    },
    rows,
    totals: {
      ...counts,
      hours: hoursFromMinutes(counts.minutes),
      checkedIn: rows.filter((r) => r.checkIn).length,
      filled: rows.filter((r) => r.state === "FILLED" || r.state === "FILLED_BY_INSTRUCTOR").length,
      pending,
      unmarked,
    },
    signoff,
    signBlockers: blockers,
  };
}

/** What a student sees for one of their classes today. Never includes the code. */
export async function studentDayState(studentId: string, classId: string) {
  const { enrollments, classes, classSessions, checkIns } = await cols();
  const enrollment = await enrollments.findOne({ classId, studentId, status: "ACTIVE" });
  if (!enrollment) return null;
  const klass = await classes.findOne({ _id: classId });
  if (!klass) return null;
  const now = new Date();
  const date = todayLocal(now);
  const [ci, session] = await Promise.all([checkIns.findOne({ classId, date }), classSessions.findOne({ classId, date })]);
  const entry = ci?.entries[enrollment._id];
  const r = session?.records[enrollment._id];
  const signed = !!session?.signoff;
  const filled = r && r.endTime && (r.status === "PRESENT" || r.status === "LATE")
    ? { startTime: r.startTime ?? "", endTime: r.endTime, lunchOut: r.lunchOut ?? "", lunchIn: r.lunchIn ?? "", hours: Number(r.hours) || 0, byInstructor: r.source !== "STUDENT_FILL" }
    : null;
  return {
    serverNow: now.getTime(),
    date,
    runsToday: !klass.archived && date >= klass.startDate && date <= klass.endDate,
    open: !!ci && isOpen(ci, now) && !signed,
    expiresAt: ci && isOpen(ci, now) ? ci.expiresAt.getTime() : null,
    sessionExists: !!ci,
    checkedIn: entry ? { time: timeLocalExact(entry.at), late: entry.status === "LATE" } : null,
    canFill: !!entry && isPendingFill(r) && !signed,
    filled,
    recorded: r && !filled && !isPendingFill(r) ? { status: r.status, hours: Number(r.hours) || 0 } : null,
    signed,
    schedule: scheduleOf(klass),
  };
}
export type StudentDayState = NonNullable<Awaited<ReturnType<typeof studentDayState>>>;

/** Admin overview: every class running today, with live counts. */
export async function todayOverview() {
  const { classes, enrollments, checkIns, classSessions, courses } = await cols();
  const now = new Date();
  const date = todayLocal(now);
  const ks = await classes.find({ archived: false, startDate: { $lte: date }, endDate: { $gte: date } }).sort({ code: 1 }).toArray();
  const ids = ks.map((k) => k._id);
  const [active, cis, sessions, cs] = await Promise.all([
    enrollments.find({ classId: { $in: ids }, status: "ACTIVE" }, { projection: { _id: 1, classId: 1 } }).toArray(),
    checkIns.find({ classId: { $in: ids }, date }).toArray(),
    classSessions.find({ classId: { $in: ids }, date }).toArray(),
    courses.find({ _id: { $in: [...new Set(ks.map((k) => k.courseId))] } }, { projection: { name: 1 } }).toArray(),
  ]);
  const teacherIds = ks.flatMap((k) => k.instructors.map((i) => i.instructorId));
  const teachers = await usersById(teacherIds);
  return {
    serverNow: now.getTime(),
    date,
    classes: ks
      .map((k) => {
        const eids = active.filter((e) => e.classId === k._id).map((e) => e._id);
        const ci = cis.find((c) => c.classId === k._id);
        const s = sessions.find((x) => x.classId === k._id);
        const recs = eids.map((id) => s?.records[id]).filter((r): r is AttendanceRecord => !!r);
        const counts = dayCounts(s?.records, eids);
        return {
          classId: k._id,
          name: `${cs.find((c) => c._id === k.courseId)?.name ?? "Course"}: ${k.code}`,
          instructors: k.instructors.map((i) => teachers.get(i.instructorId)?.name).filter(Boolean).join(", "),
          enrolled: eids.length,
          open: !!ci && isOpen(ci, now),
          expiresAt: ci && isOpen(ci, now) ? ci.expiresAt.getTime() : null,
          checkedIn: eids.filter((id) => ci?.entries[id]).length,
          pending: recs.filter((r) => isPendingFill(r)).length,
          filled: recs.filter((r) => r.source === "STUDENT_FILL" || r.source === "INSTRUCTOR_FILL").length,
          present: counts.present, late: counts.late, absent: counts.absent,
          hours: hoursFromMinutes(counts.minutes),
          signed: !!s?.signoff && s.signoff.recordsHash === dailyRecordsHash(s.records, eids),
          signedOutdated: !!s?.signoff && s.signoff.recordsHash !== dailyRecordsHash(s.records, eids),
        };
      })
      .filter((c) => c.enrolled > 0),
  };
}
