// Pure attendance-sheet rules (no DB, no secrets) shared by screens, actions, the integration API and tests.
import { createHash } from "node:crypto";
import type { AttendanceRecord, BiweeklyDay, BiweeklyCode } from "@/db/types";

export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const round2 = (n: number) => Math.round(n * 100) / 100;

export type HandTimes = { startTime?: string; lunchOut?: string; lunchIn?: string; endTime?: string };

/** Problem with a day's handwritten times, or null. Empty fields are allowed (not every day has a lunch). */
const TIME_LABELS = { startTime: "Start time", lunchOut: "Lunch out", lunchIn: "Lunch in", endTime: "End time" } as const;

export function timesProblem(input: HandTimes): string | null {
  // Only the four time fields are checked, whatever else the object carries (e.g. a whole API record).
  const t: HandTimes = { startTime: input.startTime, lunchOut: input.lunchOut, lunchIn: input.lunchIn, endTime: input.endTime };
  for (const k of Object.keys(TIME_LABELS) as (keyof HandTimes)[]) {
    const v = t[k];
    if (v && !TIME_RE.test(v)) return `${TIME_LABELS[k]}: use HH:MM (24-hour)`;
  }
  if ((t.lunchOut && !t.lunchIn) || (!t.lunchOut && t.lunchIn)) return "Enter both lunch out and lunch in, or neither";
  if (t.startTime && t.endTime && toMin(t.endTime) <= toMin(t.startTime)) return "End time must be after start time";
  if (t.lunchOut && t.lunchIn) {
    if (toMin(t.lunchIn) <= toMin(t.lunchOut)) return "Lunch in must be after lunch out";
    if (t.startTime && toMin(t.lunchOut) < toMin(t.startTime)) return "Lunch out must be after the start time";
    if (t.endTime && toMin(t.lunchIn) > toMin(t.endTime)) return "Lunch in must be before the end time";
  }
  return null;
}

/** Hours worked from the handwritten times (start to end minus lunch), or null if start/end are missing. */
export function hoursFromTimes(t: HandTimes): number | null {
  if (!t.startTime || !t.endTime || timesProblem(t)) return null;
  let m = toMin(t.endTime) - toMin(t.startTime);
  if (t.lunchOut && t.lunchIn) m -= toMin(t.lunchIn) - toMin(t.lunchOut);
  return round2(Math.max(0, m) / 60);
}

/** Hours for one biweekly day (time in to time out). A, H and S days count zero hours. */
export function biweeklyDayHours(d: Pick<BiweeklyDay, "timeIn" | "timeOut" | "code">): number {
  if (d.code) return 0;
  if (!TIME_RE.test(d.timeIn) || !TIME_RE.test(d.timeOut)) return 0;
  return round2(Math.max(0, toMin(d.timeOut) - toMin(d.timeIn)) / 60);
}

// ---------- Dates ----------

export const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const weekday = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay(); // 0 = Sunday

export const mondayOf = (date: string) => addDays(date, -((weekday(date) + 6) % 7));

/** Every date of a YYYY-MM month. */
export function monthDates(month: string): string[] {
  const out: string[] = [];
  for (let d = `${month}-01`; d.startsWith(month); d = addDays(d, 1)) out.push(d);
  return out;
}

/**
 * Biweekly periods are two weeks Monday to Sunday, counted from the Monday of the program start, so
 * every period lines up with the ITA report's "Week 1 / Week 2" columns.
 */
export function periodStartFor(programStart: string, date: string): string {
  const anchor = mondayOf(programStart);
  const diffDays = Math.round((Date.parse(`${mondayOf(date)}T12:00:00Z`) - Date.parse(`${anchor}T12:00:00Z`)) / 86_400_000);
  const n = Math.floor(diffDays / 14);
  return addDays(anchor, n * 14);
}

export const periodDates = (periodStart: string) => Array.from({ length: 14 }, (_, i) => addDays(periodStart, i));
export const periodEnd = (periodStart: string) => addDays(periodStart, 13);

/** All period starts from the program start until `until` (inclusive). */
export function periodsBetween(programStart: string, until: string): string[] {
  const out: string[] = [];
  for (let p = mondayOf(programStart); p <= until; p = addDays(p, 14)) out.push(p);
  return out;
}

/** The report is due within two business days after the period ends (weekends skipped; holidays not known here). */
export function biweeklyDueDate(periodStart: string): string {
  let d = periodEnd(periodStart);
  let n = 0;
  while (n < 2) {
    d = addDays(d, 1);
    const w = weekday(d);
    if (w !== 0 && w !== 6) n++;
  }
  return d;
}

export const BIWEEKLY_CODES: BiweeklyCode[] = ["", "A", "H", "S"];
export const BIWEEKLY_CODE_LABEL: Record<Exclude<BiweeklyCode, "">, string> = { A: "Absent, no hours", H: "Holiday", S: "Sick" };

export function biweeklyTotal(days: Pick<BiweeklyDay, "hours">[]): number {
  return round2(days.reduce((s, d) => s + (Number(d.hours) || 0), 0));
}

/** Stable hash of the sheet's content, recorded with each signature; a later change shows the signature predates it. */
export function contentHash(value: unknown): string {
  const stable = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(stable)
      : v && typeof v === "object" && !(v instanceof Date)
        ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, stable((v as Record<string, unknown>)[k])]))
        : v;
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

/** What the monthly sign-off covers: each day's mark, without who saved it or when. */
export function monthlyEntriesHash(rows: { date: string; record: Partial<AttendanceRecord> }[]): string {
  return contentHash(rows.map((r) => ({
    date: r.date, status: r.record.status, hours: r.record.hours, note: r.record.note ?? "",
    startTime: r.record.startTime ?? "", lunchOut: r.record.lunchOut ?? "", lunchIn: r.record.lunchIn ?? "", endTime: r.record.endTime ?? "",
    signed: !!r.record.studentSignature,
  })));
}
