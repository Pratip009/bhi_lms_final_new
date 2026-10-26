// Pure attendance arithmetic (no DB, no secrets): time rounding, counted hours, day totals and the
// daily sign-off hash. Everything is computed in whole minutes, so totals never drift.
import type { AttendanceRecord, DayCounts } from "@/db/types";
import { TIME_RE, contentHash, hoursFromTimes, timesProblem } from "@/lib/timesheet";

export const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
export const fromMin = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
export const hoursFromMinutes = (m: number) => Math.round((Math.max(0, m) / 60) * 100) / 100;

/**
 * Wall-clock HH:MM of an instant in the office time zone. "ceil" rounds any seconds up (used for time
 * in), "floor" drops them (time out), so a stay is never counted longer than it really was.
 */
export function localHHMM(at: Date, timeZone: string, mode: "ceil" | "floor"): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  let m = get("hour") * 60 + get("minute");
  if (mode === "ceil" && (get("second") > 0 || at.getUTCMilliseconds() > 0)) m = Math.min(m + 1, 23 * 60 + 59);
  return fromMin(m);
}

export type DaySchedule = { sessionStart?: string | null; sessionEnd?: string | null; breakStart?: string | null; breakEnd?: string | null };

/** Problem with a class's daily schedule, or null. Every part is optional, but pairs go together. */
export function scheduleProblem(s: DaySchedule): string | null {
  for (const [k, label] of [["sessionStart", "Class start"], ["sessionEnd", "Class end"], ["breakStart", "Break start"], ["breakEnd", "Break end"]] as const) {
    const v = s[k];
    if (v && !TIME_RE.test(v)) return `${label}: use HH:MM (24-hour)`;
  }
  if (!!s.sessionStart !== !!s.sessionEnd) return "Enter both the class start and end time, or neither";
  if (!!s.breakStart !== !!s.breakEnd) return "Enter both the break start and end time, or neither";
  if (s.sessionStart && s.sessionEnd && toMin(s.sessionEnd) <= toMin(s.sessionStart)) return "Class end must be after class start";
  if (s.breakStart && s.breakEnd) {
    if (toMin(s.breakEnd) <= toMin(s.breakStart)) return "Break end must be after break start";
    if (s.sessionStart && s.sessionEnd && (toMin(s.breakStart) <= toMin(s.sessionStart) || toMin(s.breakEnd) >= toMin(s.sessionEnd)))
      return "The break must be inside class time";
  }
  return null;
}

export type DayResult =
  | { ok: true; startTime: string; endTime: string; lunchOut: string; lunchIn: string; minutes: number; hours: number; adjustments: string[] }
  | { ok: false; error: string };

/**
 * Counted times and hours for a day from the (already rounded) time in and time out:
 * - before class start / after class end isn't counted (when the class has a schedule);
 * - arriving during the break counts from the end of the break; leaving during it counts to its start;
 * - a break fully inside the stay is deducted and written as lunch out / lunch in.
 * The result always passes timesProblem() and its hours equal hoursFromTimes() of the same times,
 * so the sheets, the PDFs and these totals can never disagree.
 */
export function computeDay(timeIn: string, timeOut: string, s: DaySchedule): DayResult {
  if (!TIME_RE.test(timeIn) || !TIME_RE.test(timeOut)) return { ok: false, error: "Invalid time." };
  let start = toMin(timeIn);
  let end = toMin(timeOut);
  const adjustments: string[] = [];
  if (s.sessionStart && start < toMin(s.sessionStart)) {
    start = toMin(s.sessionStart);
    adjustments.push(`counted from class start ${s.sessionStart}`);
  }
  if (s.sessionEnd && end > toMin(s.sessionEnd)) {
    end = toMin(s.sessionEnd);
    adjustments.push(`counted to class end ${s.sessionEnd}`);
  }
  let lunchOut = "", lunchIn = "";
  if (s.breakStart && s.breakEnd) {
    const bs = toMin(s.breakStart), be = toMin(s.breakEnd);
    if (start >= bs && start < be) { start = be; adjustments.push(`arrived during the break, counted from ${s.breakEnd}`); }
    if (end > bs && end <= be) { end = bs; adjustments.push(`left during the break, counted to ${s.breakStart}`); }
    if (start < bs && end > be) {
      lunchOut = s.breakStart; lunchIn = s.breakEnd;
      adjustments.push(`break ${s.breakStart}–${s.breakEnd} not counted`);
    }
  }
  if (end <= start) return { ok: false, error: `No class time to count between ${timeIn} and ${timeOut}.` };
  const times = { startTime: fromMin(start), endTime: fromMin(end), lunchOut, lunchIn };
  const minutes = end - start - (lunchOut ? toMin(lunchIn) - toMin(lunchOut) : 0);
  // Defensive: the result must satisfy the same rules the sheets enforce.
  if (timesProblem(times)) return { ok: false, error: timesProblem(times)! };
  const hours = hoursFromMinutes(minutes);
  if (hoursFromTimes(times) !== hours) return { ok: false, error: "Hours could not be calculated consistently." };
  return { ok: true, ...times, minutes, hours, adjustments };
}

const ATTENDED = new Set(["PRESENT", "LATE"]);

/**
 * Exact minutes of a record. Uses the stored minutes only while they still match the stored hours
 * (a later edit by a screen that only sets hours makes them stale), otherwise hours × 60.
 */
export function minutesOf(r: Pick<AttendanceRecord, "hours" | "status"> & { minutes?: number | null }): number {
  if (!ATTENDED.has(r.status)) return 0;
  const h = Number(r.hours) || 0;
  if (typeof r.minutes === "number" && Math.abs(r.minutes / 60 - h) < 0.005) return r.minutes;
  return Math.round(h * 60);
}

/** Checked in, but the day hasn't been filled out yet (no time out). */
export const isPendingFill = (r?: Partial<AttendanceRecord> | null) =>
  !!r && r.source === "CHECKIN" && !r.endTime && (r.status === "PRESENT" || r.status === "LATE");

export function dayCounts(records: Record<string, AttendanceRecord> | undefined, enrollmentIds: string[]): DayCounts {
  const c: DayCounts = { enrolled: enrollmentIds.length, present: 0, late: 0, absent: 0, excused: 0, holiday: 0, minutes: 0 };
  for (const id of enrollmentIds) {
    const r = records?.[id];
    if (!r) continue;
    if (r.status === "PRESENT") c.present++;
    else if (r.status === "LATE") c.late++;
    else if (r.status === "ABSENT") c.absent++;
    else if (r.status === "EXCUSED") c.excused++;
    else if (r.status === "HOLIDAY") c.holiday++;
    c.minutes += minutesOf(r);
  }
  return c;
}

/** What the instructor's daily signature covers: every listed student's mark (missing marks included). */
export function dailyRecordsHash(records: Record<string, AttendanceRecord> | undefined, enrollmentIds: string[]): string {
  return contentHash([...enrollmentIds].sort().map((id) => {
    const r = records?.[id];
    return r
      ? { id, status: r.status, hours: r.hours, note: r.note ?? "", startTime: r.startTime ?? "", lunchOut: r.lunchOut ?? "", lunchIn: r.lunchIn ?? "", endTime: r.endTime ?? "" }
      : { id, missing: true };
  }));
}

/** "Maria del Carmen Lopez" -> "ML". Used as the student's initials on the EQISS biweekly report when they fill out a day. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "";
  const first = words[0][0] ?? "";
  const last = words.length > 1 ? words[words.length - 1][0] ?? "" : "";
  return (first + last).toUpperCase().slice(0, 6);
}
