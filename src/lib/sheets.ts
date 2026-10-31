import "server-only";
import { cols, newId, isDuplicateKey, type Enrollment, type BiweeklyTimesheet, type BiweeklyDay, type BiweeklyCode, type AttendanceRecord } from "@/db";
import { getClassWithCourse } from "@/lib/queries";
import { todayLocal, thisMonthLocal } from "@/lib/dates";
import { attendanceFormatFor, type AttendanceFormat } from "@/lib/forms/templates";
import {
  biweeklyDayHours, biweeklyTotal, contentHash, hoursFromTimes, monthDates, monthlyEntriesHash, periodDates, periodEnd, periodStartFor, periodsBetween,
} from "@/lib/timesheet";
import { hoursFromMinutes, minutesOf } from "@/lib/attendance-math";
import { biweeklyCodeFor, statusForBiweeklyCode } from "@/lib/attendance-rules";

/** The attendance sheet a student uses, from their application's funding track. */
export async function sheetFormatFor(studentId: string): Promise<AttendanceFormat> {
  const app = await (await cols()).applications.findOne({ studentId }, { projection: { category: 1 } });
  return attendanceFormatFor(app?.category);
}

// ---------- DFS / Private: monthly handwritten sheet ----------

export type MonthlyRow = { date: string; record: AttendanceRecord | null; inClass: boolean; enrolled: boolean };

export async function loadMonthlySheet(enrollment: Enrollment, month: string) {
  const { classSessions, users, attendanceSignoffs } = await cols();
  const row = await getClassWithCourse(enrollment.classId);
  if (!row) return null;
  const { klass, course } = row;
  const sessions = await classSessions.find({ classId: klass._id, date: { $gte: `${month}-01`, $lte: `${month}-31` } }).toArray();
  const byDate = new Map(sessions.map((s) => [s.date, s.records[enrollment._id] ?? null]));
  const today = todayLocal();
  const endedOn = enrollment.endedAt ? todayLocal(enrollment.endedAt) : null;
  const rows: MonthlyRow[] = monthDates(month).map((date) => ({
    date,
    record: byDate.get(date) ?? null,
    inClass: date >= klass.startDate && date <= klass.endDate && date <= today,
    enrolled: !endedOn || date <= endedOn,
  }));
  const recorded = rows.filter((r) => r.record).map((r) => ({ date: r.date, record: r.record! }));
  const signoff = await attendanceSignoffs.findOne({ enrollmentId: enrollment._id, month });
  const hash = monthlyEntriesHash(recorded);
  const student = await users.findOne({ _id: enrollment.studentId }, { projection: { name: 1, email: 1 } });
  const totals = {
    // Added in whole minutes, so many short days can't drift by rounding.
    hours: hoursFromMinutes(recorded.reduce((s, r) => s + minutesOf(r.record), 0)),
    present: recorded.filter((r) => r.record.status === "PRESENT" || r.record.status === "LATE").length,
    absent: recorded.filter((r) => r.record.status === "ABSENT").length,
    holiday: recorded.filter((r) => r.record.status === "HOLIDAY").length,
  };
  return { klass, course, student, rows, signoff, entriesHash: hash, changedSinceSignoff: !!signoff && signoff.entriesHash !== hash, totals };
}

/** Months a sheet exists for: from the class start (or enrollment) to now / class end. */
export function sheetMonths(startDate: string, endDate: string): string[] {
  const last = [endDate.slice(0, 7), thisMonthLocal()].sort()[0];
  const out: string[] = [];
  for (let m = startDate.slice(0, 7); m <= last; m = nextMonth(m)) out.push(m);
  return out.reverse();
}
const nextMonth = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
};

// ---------- EQISS / One-Stop: biweekly ITA report ----------

/**
 * Where a student's two-week periods are counted from: the start of the first section they joined in
 * this course. A student moved to another section mid-way keeps the same Week 1 / Week 2 boundaries,
 * so no fortnight is split differently on two reports.
 */
export async function periodAnchor(enrollment: Pick<Enrollment, "studentId" | "courseId" | "classId">): Promise<string> {
  const { enrollments, classes } = await cols();
  const ids = (await enrollments.find({ studentId: enrollment.studentId, courseId: enrollment.courseId }, { projection: { classId: 1 } }).toArray()).map((e) => e.classId);
  const ks = await classes.find({ _id: { $in: [...new Set([...ids, enrollment.classId])] } }, { projection: { startDate: 1 } }).toArray();
  return ks.map((k) => k.startDate).sort()[0] ?? "";
}

export function biweeklyPeriodsFor(klass: { startDate: string; endDate: string }, anchor = klass.startDate) {
  const today = todayLocal();
  const until = today < klass.endDate ? today : klass.endDate;
  return periodsBetween(anchor, until).filter((p) => periodEnd(p) >= klass.startDate).reverse();
}

export const currentPeriodFor = (klass: { startDate: string; endDate: string }, anchor = klass.startDate) => {
  const today = todayLocal();
  return periodStartFor(anchor, today < klass.endDate ? (today < klass.startDate ? klass.startDate : today) : klass.endDate);
};

/**
 * What each signature covers. The customer certifies their attendance (dates, times, codes, initials);
 * the instructor certifies the whole sheet, so the instructor can add their initials, grades and comments
 * after the customer signed without the customer's signature being flagged.
 */
export const biweeklyContentHash = (s: Pick<BiweeklyTimesheet, "header" | "days" | "comments" | "progress">) =>
  contentHash({ header: s.header, days: s.days, comments: s.comments, progress: s.progress });
export const customerContentHash = (s: Pick<BiweeklyTimesheet, "days">) =>
  contentHash(s.days.map((d) => ({ date: d.date, timeIn: d.timeIn, timeOut: d.timeOut, code: d.code, customerInitials: d.customerInitials })));

/**
 * Gets (creating on first open) the biweekly sheet for an enrollment and period. A new sheet copies the
 * header from the student's previous sheet (contract number, case manager...) and pre-fills each day
 * from attendance already recorded for that date.
 */
export async function getOrCreateBiweekly(enrollment: Enrollment, periodStart: string): Promise<BiweeklyTimesheet | null> {
  const { biweeklySheets, classSessions, applications } = await cols();
  const existing = await biweeklySheets.findOne({ enrollmentId: enrollment._id, periodStart });
  if (existing) return existing;
  const row = await getClassWithCourse(enrollment.classId);
  if (!row) return null;
  const { klass, course } = row;
  if (periodStart !== periodStartFor((await periodAnchor(enrollment)) || klass.startDate, periodStart)) return null; // not a valid period boundary
  const previous = await biweeklySheets.find({ studentId: enrollment.studentId, courseId: klass.courseId }).sort({ periodStart: -1 }).limit(1).next();
  const app = await applications.findOne({ studentId: enrollment.studentId }, { projection: { county: 1 } });
  const dates = periodDates(periodStart);
  const sessions = await classSessions.find({ classId: klass._id, date: { $in: dates } }).toArray();
  const days: BiweeklyDay[] = dates.map((date) => {
    const r = sessions.find((s) => s.date === date)?.records[enrollment._id];
    const code = r?.status === "ABSENT" ? "A" : r?.status === "HOLIDAY" ? "H" : "";
    const day = { date, timeIn: code ? "" : r?.startTime ?? "", timeOut: code ? "" : r?.endTime ?? "", code, customerInitials: "", instructorInitials: "", hours: 0 } as BiweeklyDay;
    day.hours = day.timeIn && day.timeOut ? biweeklyDayHours(day) : code ? 0 : Number(r?.hours ?? 0) || (hoursFromTimes(r ?? {}) ?? 0);
    return day;
  });
  const now = new Date();
  const sheet: BiweeklyTimesheet = {
    _id: newId(), enrollmentId: enrollment._id, studentId: enrollment.studentId, classId: klass._id, courseId: klass.courseId, county: app?.county ?? null,
    periodStart, periodEnd: periodEnd(periodStart),
    header: previous?.header ?? {
      ssnLast4: "", contractNumber: "", caseManager: "", schoolName: "Bright Horizon Institute", trainingLocation: klass.location,
      trainingName: course.name, programStart: klass.startDate, programEnd: klass.endDate, totalProgramHours: 0, scheduledHours: 0,
    },
    days, comments: "", progress: { courseGrades: "", indicator: "", additionalComments: "" },
    customerSignature: null, instructorSignature: null, status: "OPEN", history: [], createdAt: now, updatedAt: now,
  };
  try {
    await biweeklySheets.insertOne(sheet);
    return sheet;
  } catch (e) {
    if (!isDuplicateKey(e)) throw e;
    return biweeklySheets.findOne({ enrollmentId: enrollment._id, periodStart });
  }
}

/** Biweekly total and cumulative attended program hours (this student's sheets for the course up to this period). */
export async function biweeklyTotals(sheet: BiweeklyTimesheet) {
  const { biweeklySheets } = await cols();
  const earlier = await biweeklySheets.find({ studentId: sheet.studentId, courseId: sheet.courseId, periodStart: { $lt: sheet.periodStart } }, { projection: { days: 1 } }).toArray();
  const total = biweeklyTotal(sheet.days);
  const cumulative = Math.round((earlier.reduce((s, x) => s + biweeklyTotal(x.days), 0) + total) * 100) / 100;
  const hash = biweeklyContentHash(sheet);
  return {
    total, cumulative,
    customerSignedCurrent: !!sheet.customerSignature && sheet.customerSignature.dataHash === customerContentHash(sheet),
    instructorSignedCurrent: !!sheet.instructorSignature && sheet.instructorSignature.dataHash === hash,
  };
}

/**
 * Writes one day onto the student's EQISS biweekly report (creating that period's report if needed),
 * so the report fills itself as the student checks in and fills out. Completed (fully signed) reports
 * are never touched. Returns true when the day was written.
 */
export async function syncBiweeklyDay(
  enrollment: Enrollment, date: string, day: { timeIn: string; timeOut: string; code: BiweeklyCode; customerInitials?: string }, byId: string,
): Promise<boolean> {
  const row = await getClassWithCourse(enrollment.classId);
  if (!row) return false;
  const periodStart = periodStartFor((await periodAnchor(enrollment)) || row.klass.startDate, date);
  const { biweeklySheets } = await cols();
  for (let attempt = 0; attempt < 3; attempt++) {
    const sheet = await getOrCreateBiweekly(enrollment, periodStart);
    if (!sheet || sheet.status === "COMPLETED") return false;
    const i = sheet.days.findIndex((d) => d.date === date);
    if (i < 0) return false;
    const next: BiweeklyDay = { ...sheet.days[i], code: day.code, timeIn: day.code ? "" : day.timeIn, timeOut: day.code ? "" : day.timeOut };
    if (day.customerInitials !== undefined) next.customerInitials = day.customerInitials;
    next.hours = biweeklyDayHours(next);
    const now = new Date();
    // Optimistic: only writes if nobody saved the report in between; otherwise reload and retry.
    const res = await biweeklySheets.updateOne(
      { _id: sheet._id, updatedAt: sheet.updatedAt, status: { $ne: "COMPLETED" } },
      { $set: { [`days.${i}`]: next, updatedAt: now }, $push: { history: { at: now, byId, action: "attendance_sync" } } },
    );
    if (res.matchedCount) return true;
  }
  return false;
}

/**
 * Writes a day's attendance onto the EQISS biweekly report so the report and the daily record always
 * agree: attended days carry the times, other statuses become A / H / S with no hours. The customer's
 * initials are never filled in here; the student enters them on their own report.
 */
export async function syncRecordToBiweekly(enrollment: Enrollment, date: string, record: Pick<AttendanceRecord, "status" | "startTime" | "endTime">, byId: string) {
  const code = biweeklyCodeFor(record.status);
  return syncBiweeklyDay(enrollment, date, { timeIn: code ? "" : record.startTime ?? "", timeOut: code ? "" : record.endTime ?? "", code }, byId);
}

/**
 * The other direction: when staff change days on an EQISS biweekly report, the daily records change to
 * match, so admin screens, exports and the daily sign-off show the same thing as the report.
 */
export async function syncBiweeklyToDays(sheet: BiweeklyTimesheet, before: BiweeklyDay[], byId: string) {
  const { classSessions, enrollments } = await cols();
  const enrollment = await enrollments.findOne({ _id: sheet.enrollmentId });
  if (!enrollment) return;
  const today = todayLocal();
  const now = new Date();
  for (const d of sheet.days) {
    const prev = before.find((x) => x.date === d.date);
    if (prev && prev.code === d.code && prev.timeIn === d.timeIn && prev.timeOut === d.timeOut) continue;
    if (d.date > today) continue;
    const status = statusForBiweeklyCode(d.code);
    let fields: Record<string, unknown>;
    if (status) fields = { status, hours: 0, minutes: 0, startTime: "", lunchOut: "", lunchIn: "", endTime: "" };
    else if (d.timeIn && d.timeOut) {
      const minutes = Math.round(biweeklyDayHours(d) * 60);
      fields = { status: "PRESENT", hours: hoursFromMinutes(minutes), minutes, startTime: d.timeIn, lunchOut: "", lunchIn: "", endTime: d.timeOut };
    } else continue; // a cleared day: leave the daily record as it was
    const existing = await classSessions.findOne({ classId: sheet.classId, date: d.date }, { projection: { [`records.${enrollment._id}`]: 1 } });
    const keepLate = existing?.records?.[enrollment._id]?.status === "LATE" && fields.status === "PRESENT";
    const set: Record<string, unknown> = {};
    for (const [k, v] of Object.entries({ ...fields, ...(keepLate ? { status: "LATE" } : {}), source: "BIWEEKLY", recordedById: byId, updatedAt: now })) set[`records.${enrollment._id}.${k}`] = v;
    await classSessions.updateOne(
      { classId: sheet.classId, date: d.date },
      { $set: set, $setOnInsert: { _id: newId(), classId: sheet.classId, date: d.date, createdAt: now } },
      { upsert: true },
    ).catch(async (e) => {
      if (!isDuplicateKey(e)) throw e;
      await classSessions.updateOne({ classId: sheet.classId, date: d.date }, { $set: set });
    });
  }
}
