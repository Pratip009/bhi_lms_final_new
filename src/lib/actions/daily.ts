"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { cols, isDuplicateKey, newId, type AttendanceRecord, type AttendanceStatus } from "@/db";
import { requireUser } from "@/lib/auth";
import { assertCanManageClass, ForbiddenError } from "@/lib/authz";
import { audit } from "@/lib/audit";
import { attended, attendanceChanges, ATTENDANCE_STATUSES, dateProblem } from "@/lib/attendance-rules";
import { computeDay } from "@/lib/attendance-math";
import { TIME_RE } from "@/lib/timesheet";
import { rosterOn, scheduleOf } from "@/lib/live";
import { syncRecordToBiweekly } from "@/lib/sheets";
import type { ActionState } from "@/lib/action";

/**
 * The daily attendance sheet for one class and date, saved by the instructor (or an admin).
 * For each student: a status and, when they attended, time in and time out. Lunch is the class's break
 * (deducted automatically) and hours are calculated, so nobody types hours by hand. Absent, sick,
 * holiday and excused days always count zero hours and no times.
 *
 * Every student on the roster for that date can be marked, including students who have since moved
 * or left (their mark goes on the enrollment they had that day). EQISS students' biweekly reports are
 * updated in the same step, so the report and the daily record never disagree.
 */
export async function saveDayAction(classId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  if (user.role === "STUDENT" || !z.string().uuid().safeParse(classId).success) return { error: "You don't have access to this class." };
  try {
    await assertCanManageClass(user, classId);
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: e.message };
    throw e;
  }
  const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).safeParse(fd.get("date"));
  if (!date.success) return { error: "Choose a valid date." };
  const { classes, classSessions } = await cols();
  const klass = await classes.findOne({ _id: classId });
  if (!klass) return { error: "Class not found." };
  const problem = dateProblem(klass, date.data, user.role);
  if (problem) return { error: problem };

  const roster = await rosterOn(classId, date.data);
  const before = await classSessions.findOne({ classId, date: date.data }, { projection: { records: 1 } });
  const schedule = scheduleOf(klass);
  const now = new Date();
  const errors: Record<string, string> = {};
  const writes: { enrollmentId: string; record: AttendanceRecord; category: string | null }[] = [];

  for (const { enrollment, category } of roster) {
    const id = enrollment._id;
    const status = String(fd.get(`status_${id}`) ?? "");
    if (!status) continue; // not marked: leave as is
    if (!(ATTENDANCE_STATUSES as readonly string[]).includes(status)) { errors[`status_${id}`] = "Choose a status"; continue; }
    const note = String(fd.get(`note_${id}`) ?? "").trim().slice(0, 300);
    const prev = before?.records[id];
    let rec: AttendanceRecord;
    if (attended(status)) {
      const tin = String(fd.get(`timeIn_${id}`) ?? "").trim();
      const tout = String(fd.get(`timeOut_${id}`) ?? "").trim();
      if (!TIME_RE.test(tin)) { errors[`timeIn_${id}`] = "Enter time in"; continue; }
      if (!TIME_RE.test(tout)) { errors[`timeOut_${id}`] = "Enter time out"; continue; }
      const day = computeDay(tin, tout, schedule);
      if (!day.ok) { errors[`timeOut_${id}`] = day.error; continue; }
      rec = {
        ...(prev ?? {}), status: status as AttendanceStatus, note, startTime: day.startTime, lunchOut: day.lunchOut, lunchIn: day.lunchIn, endTime: day.endTime,
        hours: day.hours, minutes: day.minutes, source: "INSTRUCTOR", recordedById: user._id, updatedAt: now,
      } as AttendanceRecord;
    } else {
      rec = {
        ...(prev ?? {}), status: status as AttendanceStatus, note, startTime: "", lunchOut: "", lunchIn: "", endTime: "", hours: 0, minutes: 0,
        source: "INSTRUCTOR", recordedById: user._id, updatedAt: now,
      } as AttendanceRecord;
    }
    const same = prev && prev.status === rec.status && (prev.note ?? "") === rec.note && (prev.startTime ?? "") === (rec.startTime ?? "") && (prev.endTime ?? "") === (rec.endTime ?? "");
    if (!same) writes.push({ enrollmentId: id, record: rec, category });
  }
  if (Object.keys(errors).length) return { error: "Fix the highlighted students.", fieldErrors: errors };
  if (!writes.length) return { ok: true, message: "Nothing changed." };

  const set: Record<string, unknown> = {};
  for (const w of writes) set[`records.${w.enrollmentId}`] = w.record;
  const upsert = () => classSessions.updateOne({ classId, date: date.data }, { $set: set, $setOnInsert: { _id: newId(), classId, date: date.data, createdAt: now } }, { upsert: true });
  try {
    await upsert();
  } catch (e) {
    if (!isDuplicateKey(e)) throw e;
    await upsert();
  }
  for (const w of writes) {
    if (w.category !== "EQISS") continue;
    const e = roster.find((r) => r.enrollment._id === w.enrollmentId)!.enrollment;
    await syncRecordToBiweekly(e, date.data, w.record, user._id);
  }
  await audit(user._id, "attendance.record", "class", classId, {
    date: date.data, count: writes.length,
    changes: attendanceChanges(before?.records, Object.fromEntries(writes.map((w) => [w.enrollmentId, w.record]))),
  });
  revalidatePath("/instructor", "layout");
  revalidatePath("/admin", "layout");
  return { ok: true, message: `Attendance saved for ${writes.length} student${writes.length === 1 ? "" : "s"}.` };
}
