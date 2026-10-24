"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";
import { cols, newId } from "@/db";
import { env } from "@/lib/env";
import { requireUser, requireStudentStage } from "@/lib/auth";
import { assertCanManageClass, ForbiddenError } from "@/lib/authz";
import { clientMeta } from "@/lib/session";
import { rateLimit } from "@/lib/rate-limit";
import { audit } from "@/lib/audit";
import { dateProblem } from "@/lib/attendance-rules";
import { todayLocal, timeLocal } from "@/lib/dates";
import { codeMatches, isOpen, statusAt, DEFAULT_LATE_AFTER_MINUTES, MAX_OPEN_MINUTES } from "@/lib/checkin";
import type { ActionState } from "@/lib/action";

const uuid = z.string().uuid();
const DEVICE_COOKIE = "bhi_device";

function refresh() {
  revalidatePath("/instructor", "layout");
  revalidatePath("/admin", "layout");
  revalidatePath("/dashboard", "layout");
}

/** Staff side: an assigned instructor (or an admin) opens today's check-in for a class. */
export async function startCheckInAction(classId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  if (!uuid.safeParse(classId).success) return { error: "Unknown class." };
  try {
    await assertCanManageClass(user, classId);
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "You don't have access to this class." };
    throw e;
  }
  const late = z.coerce.number().int().min(0).max(120).safeParse(fd.get("lateAfterMinutes") ?? DEFAULT_LATE_AFTER_MINUTES);
  if (!late.success) return { fieldErrors: { lateAfterMinutes: "Enter 0 to 120 minutes" } };

  const { classes, enrollments, checkIns } = await cols();
  const klass = await classes.findOne({ _id: classId });
  if (!klass) return { error: "Unknown class." };
  const today = todayLocal();
  const problem = dateProblem(klass, today, "ADMIN"); // today is never edit-locked
  if (problem) return { error: problem.replace("That date", "Today") };
  if (!(await enrollments.countDocuments({ classId, status: "ACTIVE" }, { limit: 1 }))) return { error: "There are no students in this class yet." };

  const now = new Date();
  const existing = await checkIns.findOne({ classId, date: today });
  if (existing && isOpen(existing, now)) return { ok: true, message: "Check-in is already open." };
  // Reopening keeps the first opening time and every check-in so far, so reopening can't turn late arrivals into on-time ones.
  await checkIns.updateOne(
    { classId, date: today },
    {
      $set: { seed: newId(), expiresAt: new Date(now.getTime() + MAX_OPEN_MINUTES * 60_000), closedAt: null, closedById: null },
      $setOnInsert: { _id: newId(), classId, date: today, openedAt: now, openedById: user._id, lateAfterMinutes: late.data, entries: {}, createdAt: now },
    },
    { upsert: true },
  );
  await audit(user._id, existing ? "checkin.reopen" : "checkin.open", "class", classId, { date: today, lateAfterMinutes: existing?.lateAfterMinutes ?? late.data });
  refresh();
  return { ok: true, message: existing ? "Check-in reopened. Check-ins so far are kept." : "Check-in is open. Show the code to your class." };
}

/** Staff side: stop accepting check-ins for today. Safe to call twice. */
export async function closeCheckInAction(classId: string, _: ActionState): Promise<ActionState> {
  const user = await requireUser();
  if (!uuid.safeParse(classId).success) return { error: "Unknown class." };
  try {
    await assertCanManageClass(user, classId);
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "You don't have access to this class." };
    throw e;
  }
  const today = todayLocal();
  const { checkIns } = await cols();
  const res = await checkIns.updateOne({ classId, date: today, closedAt: null }, { $set: { closedAt: new Date(), closedById: user._id } });
  if (res.modifiedCount) await audit(user._id, "checkin.close", "class", classId, { date: today });
  refresh();
  return { ok: true, message: "Check-in closed. Confirm attendance on the attendance sheet and save it." };
}

/** Student side: check in to today's class with the code on the instructor's screen. */
export async function checkInAction(classId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const { user } = await requireStudentStage("DASHBOARD");
  if (!uuid.safeParse(classId).success) return { error: "Unknown class." };
  const code = String(fd.get("code") ?? "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) return { fieldErrors: { code: "Enter the 6-digit code on your instructor's screen" } };
  // 10 tries per 10 minutes: plenty for typos, useless for guessing a code that changes every 30 seconds.
  if (!(await rateLimit(`checkin:${user._id}`, 10, 600))) return { error: "Too many tries. Ask your instructor to mark you in." };

  const { enrollments, classes, checkIns } = await cols();
  const enrollment = await enrollments.findOne({ classId, studentId: user._id, status: "ACTIVE" });
  if (!enrollment) return { error: "You're not enrolled in this class." };
  const klass = await classes.findOne({ _id: classId });
  const today = todayLocal();
  if (!klass || dateProblem(klass, today, "ADMIN")) return { error: "This class isn't running today." };

  const now = new Date();
  const session = await checkIns.findOne({ classId, date: today });
  if (!session || !isOpen(session, now)) return { error: "Check-in isn't open for this class right now." };
  const mine = session.entries[enrollment._id];
  if (mine) return { ok: true, message: `You're already checked in (${timeLocal(mine.at)}).` };
  if (!codeMatches(env().SESSION_SECRET, session, code, now)) {
    await audit(user._id, "checkin.bad_code", "class", classId, { date: today });
    return { fieldErrors: { code: "That code isn't right or has changed. Check the screen and try again." } };
  }

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
  const status = statusAt(session, now);
  const { ip } = await clientMeta();
  // Atomic: only writes if this student hasn't checked in and the session is still open.
  const res = await checkIns.updateOne(
    { _id: session._id, [`entries.${enrollment._id}`]: { $exists: false }, closedAt: null, expiresAt: { $gt: now } },
    { $set: { [`entries.${enrollment._id}`]: { at: now, status, deviceId, ip } } },
  );
  if (!res.modifiedCount) {
    const again = await checkIns.findOne({ _id: session._id });
    if (again?.entries[enrollment._id]) return { ok: true, message: "You're already checked in." };
    return { error: "Check-in just closed. Ask your instructor to mark you in." };
  }
  await audit(user._id, "checkin.student", "class", classId, { date: today, enrollmentId: enrollment._id, status });
  refresh();
  return { ok: true, message: `You're checked in${status === "LATE" ? " (late)" : ""} at ${timeLocal(now)}. Your instructor will confirm your attendance.` };
}
