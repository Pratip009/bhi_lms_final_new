// Pure rules (no secrets or DB access), so they can be unit-tested directly.
import type { AttendanceRecord, Enrollment, Klass, User } from "@/db";
import { localDateOf, todayLocal } from "@/lib/dates";

/**
 * Rules shared by the instructor screen and the attendance-app integration, so the two entry
 * points can't disagree about what is a valid mark.
 */

/** Days after which an instructor can no longer change a date's attendance (admins always can). 0 = no lock. */
export const editLockDays = () => Math.max(0, Number(process.env.ATTENDANCE_EDIT_DAYS ?? 0) || 0);

export function dateProblem(klass: Klass, date: string, role: User["role"]): string | null {
  if (klass.archived) return "This class is archived.";
  const today = todayLocal();
  if (date > today) return "You can't record attendance for a future date.";
  if (date < klass.startDate || date > klass.endDate) return "That date is outside the class dates.";
  const lock = editLockDays();
  if (lock && role !== "ADMIN") {
    const cutoff = todayLocal(new Date(Date.now() - lock * 86_400_000));
    if (date < cutoff) return `Attendance older than ${lock} days is locked. Ask an admin to change it.`;
  }
  return null;
}

/** A student can be marked on a date only while enrolled: active, or the date is on/before the day they left. */
export function enrolledOn(e: Pick<Enrollment, "status" | "endedAt">, date: string): boolean {
  if (e.status === "ACTIVE") return true;
  return !!e.endedAt && date <= localDateOf(e.endedAt);
}

type Mark = Pick<AttendanceRecord, "status" | "hours" | "note"> & Partial<Pick<AttendanceRecord, "startTime" | "lunchOut" | "lunchIn" | "endTime">>;
const KEYS = ["status", "hours", "note", "startTime", "lunchOut", "lunchIn", "endTime"] as const;

/** Before/after values for the audit log, so changes to past attendance are traceable. Only fields being written are compared. */
export function attendanceChanges(before: Record<string, AttendanceRecord> | undefined, after: Record<string, Mark>) {
  const changes: { enrollmentId: string; from: Partial<Mark> | null; to: Mark }[] = [];
  for (const [enrollmentId, to] of Object.entries(after)) {
    const prev = before?.[enrollmentId];
    const keys = KEYS.filter((k) => k in to);
    const from = prev ? Object.fromEntries(keys.map((k) => [k, prev[k] ?? (k === "note" ? "" : undefined)])) as Partial<Mark> : null;
    const differs = !from || keys.some((k) => (from[k] ?? "") !== (to[k] ?? ""));
    if (differs) changes.push({ enrollmentId, from, to });
  }
  return changes;
}

export const ATTENDANCE_STATUSES = ["PRESENT", "LATE", "ABSENT", "EXCUSED", "HOLIDAY"] as const;
