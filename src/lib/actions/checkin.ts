"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";
import { cols, isDuplicateKey, newId, type AttendanceRecord, type User } from "@/db";
import { env } from "@/lib/env";
import { requireUser, requireStudentStage } from "@/lib/auth";
import { assertCanManageClass, ForbiddenError } from "@/lib/authz";
import { clientMeta } from "@/lib/session";
import { rateLimit } from "@/lib/rate-limit";
import { audit } from "@/lib/audit";
import { dateProblem } from "@/lib/attendance-rules";
import { APP_TIMEZONE, timeLocal, timeLocalExact, todayLocal } from "@/lib/dates";
import { checkInStatus, codeMatches, isOpen, statusAt, CODE_VALID_MINUTES, CODE_VALID_MS } from "@/lib/checkin";
import { computeDay, dailyRecordsHash, dayCounts, initialsOf, isPendingFill, localHHMM } from "@/lib/attendance-math";
import { loadDayBoard, rosterOn, scheduleOf } from "@/lib/live";
import { sheetFormatFor, syncBiweeklyDay } from "@/lib/sheets";
import type { ActionState } from "@/lib/action";

const uuid = z.string().uuid();
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const signatureSchema = z.string().regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/).max(300_000);
const DEVICE_COOKIE = "bhi_device";

function refresh() {
  revalidatePath("/instructor", "layout");
  revalidatePath("/admin", "layout");
  revalidatePath("/dashboard", "layout");
}

/** Checks the user may manage the class; returns an error state instead of throwing. */
async function canManage(user: User, classId: string): Promise<ActionState | null> {
  if (!uuid.safeParse(classId).success) return { error: "Unknown class." };
  try {
    await assertCanManageClass(user, classId);
    return null;
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "You don't have access to this class." };
    throw e;
  }
}

/** The day's attendance document must exist before single records are written into it. */
async function ensureDayDoc(classId: string, date: string) {
  const { classSessions } = await cols();
  try {
    await classSessions.updateOne(
      { classId, date },
      { $setOnInsert: { _id: newId(), classId, date, records: {}, createdAt: new Date() } },
      { upsert: true },
    );
  } catch (e) {
    if (!isDuplicateKey(e)) throw e; // created by someone else at the same moment
  }
}

/** True when the class day has been signed by the instructor (signed days take no new check-ins or fills). */
async function daySigned(classId: string, date: string) {
  const { classSessions } = await cols();
  return (await classSessions.countDocuments({ classId, date, signoff: { $ne: null } }, { limit: 1 })) > 0;
}

// ---------- Codes ----------

/**
 * Staff: issues today's check-in code. It works for exactly CODE_VALID_MINUTES. The first code of the
 * day sets the on-time window; a later code (for latecomers) replaces the old one, and check-ins with
 * it are late. Issuing never deletes earlier check-ins.
 */
export async function startCheckInAction(classId: string, _: ActionState): Promise<ActionState> {
  const user = await requireUser();
  const denied = await canManage(user, classId);
  if (denied) return denied;
  const { classes, enrollments, checkIns } = await cols();
  const klass = await classes.findOne({ _id: classId });
  if (!klass) return { error: "Unknown class." };
  const now = new Date();
  const today = todayLocal(now);
  const problem = dateProblem(klass, today, "ADMIN"); // today is never edit-locked
  if (problem) return { error: problem.replace("That date", "Today") };
  if (!klass.checkInEnabled) return { error: "Check-in codes are turned off for this class. Turn them on in Class settings, or mark attendance on the sheet." };
  if (!(await enrollments.countDocuments({ classId, status: "ACTIVE" }, { limit: 1 }))) return { error: "There are no students in this class yet." };
  if (await daySigned(classId, today)) return { error: "Today's attendance is already signed. Check-in can't be reopened." };

  const existing = await checkIns.findOne({ classId, date: today });
  if (existing && isOpen(existing, now)) return { ok: true, message: `The current code still works until ${timeLocalExact(existing.expiresAt)}.` };
  const expiresAt = new Date(now.getTime() + CODE_VALID_MS);
  await checkIns.updateOne(
    { classId, date: today },
    {
      $set: { seed: newId(), expiresAt, closedAt: null, closedById: null },
      $push: { rounds: { openedAt: now, expiresAt, openedById: user._id } },
      // The first code of the day fixes the on-time window; later codes never move it.
      $setOnInsert: { _id: newId(), classId, date: today, openedAt: now, openedById: user._id, lateAfterMinutes: CODE_VALID_MINUTES, entries: {}, createdAt: now },
    },
    { upsert: true },
  );
  await audit(user._id, existing ? "checkin.new_code" : "checkin.open", "class", classId, { date: today, expiresAt });
  refresh();
  if (!existing) return { ok: true, message: `Code issued. It works for ${CODE_VALID_MINUTES} minutes, until ${timeLocalExact(expiresAt)}. Students who check in now are on time.` };
  const lateNow = statusAt(existing, now) === "LATE";
  return { ok: true, message: `New code issued (the old one no longer works). It works until ${timeLocalExact(expiresAt)}.${lateNow ? " Check-ins with it are marked late." : ""}` };
}

/** Staff: stops the current code before its 10 minutes are up. Safe to call twice. */
export async function closeCheckInAction(classId: string, _: ActionState): Promise<ActionState> {
  const user = await requireUser();
  const denied = await canManage(user, classId);
  if (denied) return denied;
  const today = todayLocal();
  const { checkIns } = await cols();
  const res = await checkIns.updateOne({ classId, date: today, closedAt: null }, { $set: { closedAt: new Date(), closedById: user._id } });
  if (res.modifiedCount) await audit(user._id, "checkin.close", "class", classId, { date: today });
  refresh();
  return { ok: true, message: "Check-in closed. The code no longer works." };
}

// ---------- Student ----------

/**
 * Student: checks in with the code on the instructor's screen. The check-in time is the server's clock
 * at the moment the code is accepted, and it is written to today's attendance sheet straight away.
 */
export async function checkInAction(classId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const { user } = await requireStudentStage("DASHBOARD");
  if (!uuid.safeParse(classId).success) return { error: "Unknown class." };
  const code = String(fd.get("code") ?? "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) return { fieldErrors: { code: "Enter the 6-digit code on your instructor's screen" } };
  // 10 tries per 10 minutes: plenty for typos, useless for guessing one of a million codes.
  if (!(await rateLimit(`checkin:${user._id}`, 10, 600))) return { error: "Too many tries. Ask your instructor to mark you in." };

  const { enrollments, classes, checkIns, classSessions } = await cols();
  const enrollment = await enrollments.findOne({ classId, studentId: user._id, status: "ACTIVE" });
  if (!enrollment) return { error: "You're not enrolled in this class." };
  const klass = await classes.findOne({ _id: classId });
  const today = todayLocal();
  if (!klass || dateProblem(klass, today, "ADMIN")) return { error: "This class isn't running today." };

  const now = new Date();
  const session = await checkIns.findOne({ classId, date: today });
  if (!session || !isOpen(session, now)) return { error: "There's no valid code right now. Codes work for 10 minutes; ask your instructor for a new one." };
  const mine = session.entries[enrollment._id];
  if (mine) return { ok: true, message: `You're already checked in (${timeLocalExact(mine.at)}).` };
  if (!codeMatches(env().SESSION_SECRET, session, code)) {
    await audit(user._id, "checkin.bad_code", "class", classId, { date: today });
    return { fieldErrors: { code: "That code isn't right. Check the screen and try again." } };
  }
  if (await daySigned(classId, today)) return { error: "Today's attendance is already signed. Ask your instructor." };

  // A random id kept in a long-lived cookie on this browser. Two students checking in from the same
  // device is flagged to the instructor as a possible check-in on someone else's behalf.
  const jar = await cookies();
  let deviceId = jar.get(DEVICE_COOKIE)?.value ?? "";
  if (!uuid.safeParse(deviceId).success) {
    deviceId = newId();
    jar.set(DEVICE_COOKIE, deviceId, {
      httpOnly: true, sameSite: "lax", path: "/", maxAge: 400 * 86_400,
      secure: env().NODE_ENV === "production" && env().APP_URL.startsWith("https://"),
    });
  }
  // Late is measured from the class start time when one is set (plus the class's grace minutes);
  // without a start time, from when the first code of the day was issued.
  const status = checkInStatus(localHHMM(now, APP_TIMEZONE, "floor"), klass.sessionStart, klass.lateAfterMinutes ?? CODE_VALID_MINUTES, statusAt(session, now));
  const { ip } = await clientMeta();
  const round = session.rounds?.length ?? 1;
  // Atomic: only writes if this student hasn't checked in, the same code is still current and unexpired.
  const res = await checkIns.updateOne(
    { _id: session._id, seed: session.seed, [`entries.${enrollment._id}`]: { $exists: false }, closedAt: null, expiresAt: { $gt: now } },
    { $set: { [`entries.${enrollment._id}`]: { at: now, status, deviceId, ip, round, filledAt: null } } },
  );
  if (!res.modifiedCount) {
    const again = await checkIns.findOne({ _id: session._id });
    if (again?.entries[enrollment._id]) return { ok: true, message: "You're already checked in." };
    return { error: "The code just expired. Ask your instructor for a new one." };
  }

  // Time in goes on today's sheet now, unless staff already recorded the day (an automatic absence is replaced).
  await ensureDayDoc(classId, today);
  const record: AttendanceRecord = {
    status, hours: 0, minutes: 0, note: `Checked in ${timeLocal(now)}${status === "LATE" ? " (late)" : ""}`,
    startTime: localHHMM(now, APP_TIMEZONE, "ceil"), source: "CHECKIN", checkInAt: now, checkOutAt: null, studentFilledAt: null,
    recordedById: user._id, updatedAt: now,
  };
  await classSessions.updateOne(
    { classId, date: today, signoff: null, $or: [{ [`records.${enrollment._id}`]: { $exists: false } }, { [`records.${enrollment._id}.source`]: "AUTO_ABSENT" }] },
    { $set: { [`records.${enrollment._id}`]: record } },
  );
  await audit(user._id, "checkin.student", "class", classId, { date: today, enrollmentId: enrollment._id, status, round });
  refresh();
  return { ok: true, message: `Checked in at ${timeLocalExact(now)}${status === "LATE" ? " (late)" : " (on time)"}. Press “Fill my attendance” when class ends.` };
}

/**
 * Student: fills out today's attendance with one press at the end of class (no signature needed).
 * Time out is the server's clock now; hours are counted inside class time with the break deducted.
 */
export async function fillMyAttendanceAction(classId: string, _: ActionState): Promise<ActionState> {
  const { user } = await requireStudentStage("DASHBOARD");
  if (!uuid.safeParse(classId).success) return { error: "Unknown class." };
  if (!(await rateLimit(`fill:${user._id}`, 20, 600))) return { error: "Too many tries. Wait a few minutes." };
  const { enrollments, classes, checkIns, classSessions } = await cols();
  const enrollment = await enrollments.findOne({ classId, studentId: user._id, status: "ACTIVE" });
  if (!enrollment) return { error: "You're not enrolled in this class." };
  const klass = await classes.findOne({ _id: classId });
  if (!klass) return { error: "Unknown class." };
  const now = new Date();
  const today = todayLocal(now);
  const ci = await checkIns.findOne({ classId, date: today });
  const entry = ci?.entries[enrollment._id];
  if (!entry) return { error: "Check in first with your instructor's code." };
  const day = await classSessions.findOne({ classId, date: today });
  if (day?.signoff) return { error: "Today's attendance is already signed by your instructor." };
  const rec = day?.records[enrollment._id];
  if (!isPendingFill(rec)) {
    if (rec?.endTime) return { ok: true, message: `Already filled out: ${rec.startTime}–${rec.endTime}, ${Number(rec.hours).toFixed(2)} h.` };
    return { error: "Your instructor has already recorded today's attendance for you." };
  }

  const timeIn = localHHMM(entry.at, APP_TIMEZONE, "ceil");
  const timeOut = localHHMM(now, APP_TIMEZONE, "floor");
  const result = computeDay(timeIn, timeOut, scheduleOf(klass));
  if (!result.ok) return { error: `${result.error} Press the button when class is over.` };

  const set: Record<string, unknown> = {};
  const fields = {
    status: entry.status, startTime: result.startTime, lunchOut: result.lunchOut, lunchIn: result.lunchIn, endTime: result.endTime,
    hours: result.hours, minutes: result.minutes,
    note: `Checked in ${timeLocal(entry.at)}, filled out ${timeLocal(now)}${result.adjustments.length ? `; ${result.adjustments.join("; ")}` : ""}`,
    source: "STUDENT_FILL", checkInAt: entry.at, checkOutAt: now, studentFilledAt: now, recordedById: user._id, updatedAt: now,
  };
  for (const [k, v] of Object.entries(fields)) set[`records.${enrollment._id}.${k}`] = v;
  // Atomic: only if the day is still unsigned and still waiting for this student's fill-out.
  const res = await classSessions.updateOne(
    { classId, date: today, signoff: null, [`records.${enrollment._id}.source`]: "CHECKIN", [`records.${enrollment._id}.endTime`]: { $in: [null, ""] } },
    { $set: set },
  );
  if (!res.modifiedCount) return { error: "Today's attendance changed meanwhile. Reload the page." };
  await checkIns.updateOne({ _id: ci!._id }, { $set: { [`entries.${enrollment._id}.filledAt`]: now } });
  if ((await sheetFormatFor(user._id)) === "BIWEEKLY") {
    // The customer initials are left for the student to enter on their own report (never filled in for them).
    await syncBiweeklyDay(enrollment, today, { timeIn: result.startTime, timeOut: result.endTime, code: "" }, user._id);
  }
  await audit(user._id, "attendance.student_fill", "class", classId, { date: today, enrollmentId: enrollment._id, ...fields, checkInAt: entry.at.toISOString(), checkOutAt: now.toISOString() });
  refresh();
  const lunch = result.lunchOut ? ` (break ${result.lunchOut}–${result.lunchIn} not counted)` : "";
  return { ok: true, message: `Attendance filled: ${result.startTime}–${result.endTime}${lunch}, ${result.hours.toFixed(2)} h.` };
}

// ---------- Staff: complete and sign the day ----------

/**
 * Staff: completes a class day so it can be signed. Students who never checked in are marked absent;
 * students who checked in but didn't fill out get their time out filled (now for today, or the class
 * end time for an earlier day). Marks staff already entered are never overwritten.
 */
export async function completeDayAction(classId: string, date: string, _: ActionState): Promise<ActionState> {
  const user = await requireUser();
  const denied = await canManage(user, classId);
  if (denied) return denied;
  if (!dateSchema.safeParse(date).success) return { error: "Invalid date." };
  const { classes, checkIns, classSessions } = await cols();
  const klass = await classes.findOne({ _id: classId });
  if (!klass) return { error: "Unknown class." };
  const problem = dateProblem(klass, date, user.role);
  if (problem) return { error: problem };
  const now = new Date();
  const today = todayLocal(now);
  const schedule = scheduleOf(klass);
  if (date < today && !schedule.sessionEnd) {
    const day = await classSessions.findOne({ classId, date }, { projection: { records: 1 } });
    if (Object.values(day?.records ?? {}).some((r) => isPendingFill(r)))
      return { error: "Set the class end time in Class settings first, so earlier days can be filled out to the end of class. Or correct those students by hand." };
  }
  if (date === today) await checkIns.updateOne({ classId, date, closedAt: null }, { $set: { closedAt: now, closedById: user._id } });
  await ensureDayDoc(classId, date);
  const roster = await rosterOn(classId, date);
  const ci = await checkIns.findOne({ classId, date });
  const day = await classSessions.findOne({ classId, date });
  const timeOut = date === today ? localHHMM(now, APP_TIMEZONE, "floor") : schedule.sessionEnd!;
  let absent = 0, filled = 0;
  const problems: string[] = [];

  for (const { enrollment, student, category } of roster) {
    const id = enrollment._id;
    const r = day?.records[id];
    const entry = ci?.entries[id];
    if (!r && !entry) {
      const rec: AttendanceRecord = { status: "ABSENT", hours: 0, minutes: 0, note: "Did not check in", source: "AUTO_ABSENT", recordedById: user._id, updatedAt: now };
      const res = await classSessions.updateOne({ classId, date, [`records.${id}`]: { $exists: false } }, { $set: { [`records.${id}`]: rec } });
      if (res.modifiedCount) {
        absent++;
        if (category === "EQISS") await syncBiweeklyDay(enrollment, date, { timeIn: "", timeOut: "", code: "A" }, user._id);
      }
      continue;
    }
    if (!(isPendingFill(r) || (!r && entry))) continue; // already decided
    const at = r?.checkInAt ?? entry?.at;
    if (!at) continue;
    const result = computeDay(localHHMM(at, APP_TIMEZONE, "ceil"), timeOut, schedule);
    if (!result.ok) { problems.push(`${student.name}: ${result.error}`); continue; }
    const status = r?.status ?? entry!.status;
    const fields = {
      status, startTime: result.startTime, lunchOut: result.lunchOut, lunchIn: result.lunchIn, endTime: result.endTime,
      hours: result.hours, minutes: result.minutes, source: "INSTRUCTOR_FILL", checkInAt: at, checkOutAt: now, studentFilledAt: null,
      note: `Checked in ${timeLocal(at)}; time out filled by instructor${result.adjustments.length ? `; ${result.adjustments.join("; ")}` : ""}`,
      recordedById: user._id, updatedAt: now,
    };
    const set = Object.fromEntries(Object.entries(fields).map(([k, v]) => [`records.${id}.${k}`, v]));
    const res = await classSessions.updateOne(
      { classId, date, $or: [{ [`records.${id}`]: { $exists: false } }, { [`records.${id}.source`]: "CHECKIN", [`records.${id}.endTime`]: { $in: [null, ""] } }] },
      { $set: set },
    );
    if (res.modifiedCount) {
      filled++;
      if (category === "EQISS") await syncBiweeklyDay(enrollment, date, { timeIn: result.startTime, timeOut: result.endTime, code: "" }, user._id);
    }
  }
  await audit(user._id, "attendance.complete_day", "class", classId, { date, absent, filled, timeOut, problems });
  refresh();
  if (problems.length) return { error: `Completed ${filled + absent} students, but these need a correction: ${problems.join(" ")}` };
  return { ok: true, message: `Day completed: ${filled} filled out, ${absent} marked absent. Review the sheet, then sign it.` };
}

/**
 * Instructor: signs the class's attendance for one day. Allowed only when every student has a final
 * mark. The signature covers a hash of all marks; any later change shows the signature is out of date.
 */
export async function signDayAction(classId: string, date: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  // The class's instructor signs; an admin can sign on their behalf (e.g. when a substitute taught).
  if (user.role !== "INSTRUCTOR" && user.role !== "ADMIN") return { error: "Only staff can sign daily attendance." };
  const denied = await canManage(user, classId);
  if (denied) return denied;
  if (!dateSchema.safeParse(date).success) return { error: "Invalid date." };
  const sig = signatureSchema.safeParse(String(fd.get("signature") ?? ""));
  if (!sig.success) return { fieldErrors: { signature: "Sign in the box" } };
  const signerName = String(fd.get("signerName") ?? "").trim().slice(0, 120);
  if (signerName.length < 2) return { fieldErrors: { signerName: "Type your full name" } };

  const board = await loadDayBoard(classId, date, { includeCode: false });
  if (!board) return { error: "Unknown class." };
  if (board.signBlockers.length) return { error: `Not ready to sign: ${board.signBlockers.join(" ")}` };
  const { classSessions } = await cols();
  const day = await classSessions.findOne({ classId, date });
  if (!day) return { error: "There is no attendance for this date yet." };
  const ids = board.rows.map((r) => r.enrollmentId);
  const recordsHash = dailyRecordsHash(day.records, ids);
  if (day.signoff?.recordsHash === recordsHash) return { ok: true, message: "Already signed. Nothing changed since." };
  const signoff = {
    signature: { imageDataUrl: sig.data, signerName, signedAt: new Date(), signerId: user._id },
    recordsHash,
    counts: dayCounts(day.records, ids),
  };
  // Atomic: the stored signature must be the one we read, so two signatures can't overwrite each other.
  const res = await classSessions.updateOne(
    { _id: day._id, signoff: day.signoff ?? null },
    { $set: { signoff }, ...(day.signoff ? { $push: { signoffHistory: { signoff: day.signoff, replacedAt: new Date() } } } : {}) },
  );
  if (!res.modifiedCount) return { error: "Someone signed this day at the same moment. Reload the page." };
  // Re-check: if a mark changed between reading and signing, say so (the board shows it as out of date).
  const after = await classSessions.findOne({ _id: day._id }, { projection: { records: 1 } });
  const changed = dailyRecordsHash(after?.records, ids) !== recordsHash;
  await audit(user._id, "attendance.day_signoff", "class", classId, { date, counts: signoff.counts, resigned: !!day.signoff });
  refresh();
  if (changed) return { error: "Signed, but a mark changed while you were signing. Review the sheet and sign again." };
  return { ok: true, message: `Attendance for ${date} signed.` };
}
