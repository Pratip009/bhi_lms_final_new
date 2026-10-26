"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { cols, newId, type AttendanceStatus, type BiweeklyCode, type BiweeklyTimesheet, type User } from "@/db";
import { requireUser } from "@/lib/auth";
import { getVisibleEnrollment, ForbiddenError } from "@/lib/authz";
import { audit } from "@/lib/audit";
import { attendanceChanges, dateProblem, enrolledOn, ATTENDANCE_STATUSES } from "@/lib/attendance-rules";
import { monthSchema } from "@/lib/reports/template";
import { biweeklyDayHours, BIWEEKLY_CODES, hoursFromTimes, timesProblem, TIME_RE } from "@/lib/timesheet";
import { biweeklyContentHash, customerContentHash, loadMonthlySheet, sheetFormatFor } from "@/lib/sheets";
import { thisMonthLocal } from "@/lib/dates";
import type { ActionState } from "@/lib/action";

const uuid = z.string().uuid();
const signatureSchema = z.string().regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/, "Sign in the box").max(300_000, "Signature image is too large");

function refresh() {
  revalidatePath("/instructor", "layout");
  revalidatePath("/admin", "layout");
  revalidatePath("/dashboard", "layout");
}

const isStaff = (u: User) => u.role === "ADMIN" || (u.role === "INSTRUCTOR" && u.instructorStatus === "APPROVED" && !u.disabledAt);

/** Loads the enrollment if this user may see it; students only their own. */
async function visible(user: User, enrollmentId: string) {
  if (!uuid.safeParse(enrollmentId).success) return null;
  try {
    return await getVisibleEnrollment(user, enrollmentId);
  } catch (e) {
    if (e instanceof ForbiddenError) return null;
    throw e;
  }
}

const NO_ACCESS: ActionState = { error: "You don't have access to this record." };

// ---------- DFS / Private monthly handwritten sheet ----------

/** Instructor or admin saves one day of a student's monthly sheet (times, status, note and, optionally, the student's signature). */
export async function saveDailyEntryAction(enrollmentId: string, date: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  if (!isStaff(user)) return NO_ACCESS;
  const e = await visible(user, enrollmentId);
  if (!e) return NO_ACCESS;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Invalid date." };
  if ((await sheetFormatFor(e.studentId)) !== "MONTHLY") return { error: "This student uses the EQISS biweekly report." };
  const { classes, classSessions } = await cols();
  const klass = await classes.findOne({ _id: e.classId });
  if (!klass) return { error: "Class not found." };
  // Archived (e.g. merged) sections stay editable by admins so history can be corrected.
  const problem = klass.archived && user.role === "ADMIN" ? null : dateProblem(klass, date, user.role);
  if (problem) return { error: problem };
  if (!enrolledOn(e, date)) return { error: "The student wasn't enrolled in this section on that date." };

  const status = String(fd.get("status") ?? "");
  if (!(ATTENDANCE_STATUSES as readonly string[]).includes(status)) return { fieldErrors: { status: "Choose a status" } };
  const off = status === "ABSENT" || status === "HOLIDAY" || status === "EXCUSED";
  const times = Object.fromEntries((["startTime", "lunchOut", "lunchIn", "endTime"] as const).map((k) => [k, off ? "" : String(fd.get(k) ?? "").trim()]));
  const tp = timesProblem(times);
  if (tp) return { error: tp };
  const hoursRaw = String(fd.get("hours") ?? "").trim();
  let hours = off ? 0 : hoursFromTimes(times) ?? 0;
  if (!off && hoursRaw && hoursFromTimes(times) === null) {
    const h = Number(hoursRaw);
    if (!Number.isFinite(h) || h < 0 || h > 24) return { fieldErrors: { hours: "0 to 24" } };
    hours = Math.round(h * 100) / 100;
  }
  const note = String(fd.get("note") ?? "").trim().slice(0, 300);
  const now = new Date();
  const mark = { status: status as AttendanceStatus, hours, note, ...times };
  const set: Record<string, unknown> = {};
  const minutes = Math.round(hours * 60);
  for (const [k, v] of Object.entries({ ...mark, minutes, source: "INSTRUCTOR", recordedById: user._id, updatedAt: now })) set[`records.${e._id}.${k}`] = v;
  const sig = String(fd.get("signature") ?? "");
  if (sig) {
    const parsed = signatureSchema.safeParse(sig);
    if (!parsed.success) return { fieldErrors: { signature: parsed.error.issues[0].message } };
    set[`records.${e._id}.studentSignature`] = { imageDataUrl: parsed.data, signedAt: now, capturedById: user._id };
  }
  const before = await classSessions.findOne({ classId: e.classId, date }, { projection: { records: 1 } });
  const changes = attendanceChanges(before?.records, { [e._id]: mark });
  await classSessions.updateOne(
    { classId: e.classId, date },
    { $set: set, $setOnInsert: { _id: newId(), classId: e.classId, date, createdAt: now } },
    { upsert: true },
  ).catch(async (err) => {
    if ((err as { code?: number }).code !== 11000) throw err;
    await classSessions.updateOne({ classId: e.classId, date }, { $set: set });
  });
  await audit(user._id, "attendance.sheet_entry", "enrollment", e._id, { date, changes, studentSigned: !!sig });
  refresh();
  return { ok: true, message: `Saved ${date}.` };
}

/** Instructor (or admin) signs off a student's monthly sheet. Re-signing keeps the earlier sign-off in history. */
export async function signMonthlySheetAction(enrollmentId: string, month: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  if (!isStaff(user)) return NO_ACCESS;
  const e = await visible(user, enrollmentId);
  if (!e) return NO_ACCESS;
  if (!monthSchema.safeParse(month).success || month > thisMonthLocal()) return { error: "Invalid month." };
  const sig = signatureSchema.safeParse(String(fd.get("signature") ?? ""));
  if (!sig.success) return { fieldErrors: { signature: "Sign in the box" } };
  const signerName = String(fd.get("signerName") ?? "").trim().slice(0, 120);
  if (signerName.length < 2) return { fieldErrors: { signerName: "Type your full name" } };
  const sheet = await loadMonthlySheet(e, month);
  if (!sheet) return { error: "Class not found." };
  if (!sheet.rows.some((r) => r.record)) return { error: "There are no entries to sign for this month." };
  const signature = { imageDataUrl: sig.data, signerName, signedAt: new Date(), signerId: user._id };
  const { attendanceSignoffs } = await cols();
  const prev = sheet.signoff;
  if (prev) {
    await attendanceSignoffs.updateOne({ _id: prev._id }, {
      $set: { signature, entriesHash: sheet.entriesHash },
      $push: { history: { signature: prev.signature, entriesHash: prev.entriesHash, replacedAt: new Date() } },
    });
  } else {
    try {
      await attendanceSignoffs.insertOne({ _id: newId(), enrollmentId: e._id, month, signature, entriesHash: sheet.entriesHash, history: [] });
    } catch (err) {
      if ((err as { code?: number }).code === 11000) return { error: "This month was just signed by someone else. Reload the page." };
      throw err;
    }
  }
  await audit(user._id, "attendance.month_signoff", "enrollment", e._id, { month, resigned: !!prev });
  refresh();
  return { ok: true, message: `Attendance for ${month} signed.` };
}

// ---------- EQISS / One-Stop biweekly ITA report ----------

async function loadSheetFor(user: User, sheetId: string) {
  if (!uuid.safeParse(sheetId).success) return null;
  const sheet = await (await cols()).biweeklySheets.findOne({ _id: sheetId });
  if (!sheet) return null;
  const e = await visible(user, sheet.enrollmentId);
  return e ? { sheet, enrollment: e } : null;
}

const time = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").trim();
  return s === "" || TIME_RE.test(s) ? s : null;
};
const text = (v: FormDataEntryValue | null, max: number) => String(v ?? "").trim().slice(0, max);

/**
 * Saves the biweekly sheet. Instructors and admins edit everything except the customer's initials;
 * the student edits only their own initials. Nothing can change once both have signed, until an admin reopens it.
 */
export async function saveBiweeklyAction(sheetId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  const found = await loadSheetFor(user, sheetId);
  if (!found) return NO_ACCESS;
  const { sheet } = found;
  if (sheet.status === "COMPLETED") return { error: "This report is signed by the customer and the instructor. An admin must reopen it to change it." };
  const staff = isStaff(user);
  const student = user.role === "STUDENT" && sheet.studentId === user._id;
  if (!staff && !student) return NO_ACCESS;

  const errors: Record<string, string> = {};
  const days = sheet.days.map((d, i) => {
    const next = { ...d };
    if (student || staff) {
      // Students write only their own initials. Staff may also fill them in when the paper copy was initialled.
      const ci = text(fd.get(`customerInitials_${i}`), 6);
      if (fd.has(`customerInitials_${i}`)) next.customerInitials = ci;
    }
    if (staff) {
      const code = String(fd.get(`code_${i}`) ?? "") as BiweeklyCode;
      if (!BIWEEKLY_CODES.includes(code)) errors[`code_${i}`] = "Invalid";
      const tin = time(fd.get(`timeIn_${i}`));
      const tout = time(fd.get(`timeOut_${i}`));
      if (tin === null) errors[`timeIn_${i}`] = "HH:MM";
      if (tout === null) errors[`timeOut_${i}`] = "HH:MM";
      next.code = BIWEEKLY_CODES.includes(code) ? code : d.code;
      next.timeIn = next.code ? "" : tin ?? d.timeIn;
      next.timeOut = next.code ? "" : tout ?? d.timeOut;
      if (next.timeIn && next.timeOut && next.timeOut <= next.timeIn) errors[`timeOut_${i}`] = "After time in";
      next.instructorInitials = text(fd.get(`instructorInitials_${i}`), 6);
      next.hours = biweeklyDayHours(next);
    }
    return next;
  });
  if (Object.keys(errors).length) return { error: "Fix the highlighted days.", fieldErrors: errors };

  const update: Partial<BiweeklyTimesheet> = { days, updatedAt: new Date() };
  if (staff) {
    const num = (k: string) => {
      const n = Number(String(fd.get(k) ?? "0") || 0);
      return Number.isFinite(n) && n >= 0 && n <= 10000 ? Math.round(n * 100) / 100 : null;
    };
    const ssn = text(fd.get("ssnLast4"), 4);
    if (ssn && !/^\d{4}$/.test(ssn)) return { fieldErrors: { ssnLast4: "Last 4 digits only" } };
    const tph = num("totalProgramHours"), sh = num("scheduledHours");
    if (tph === null) return { fieldErrors: { totalProgramHours: "Enter hours" } };
    if (sh === null) return { fieldErrors: { scheduledHours: "Enter hours" } };
    const dateOk = (v: string) => v === "" || /^\d{4}-\d{2}-\d{2}$/.test(v);
    const ps = text(fd.get("programStart"), 10), pe = text(fd.get("programEnd"), 10);
    if (!dateOk(ps) || !dateOk(pe)) return { error: "Program dates must be valid dates." };
    update.header = {
      ssnLast4: ssn, contractNumber: text(fd.get("contractNumber"), 60), caseManager: text(fd.get("caseManager"), 120),
      schoolName: text(fd.get("schoolName"), 160), trainingLocation: text(fd.get("trainingLocation"), 200), trainingName: text(fd.get("trainingName"), 200),
      programStart: ps, programEnd: pe, totalProgramHours: tph, scheduledHours: sh,
    };
    update.comments = text(fd.get("comments"), 3000);
    const indicator = String(fd.get("indicator") ?? "");
    update.progress = {
      courseGrades: text(fd.get("courseGrades"), 1000),
      indicator: indicator === "ABOVE_AVERAGE" || indicator === "BELOW_AVERAGE" ? indicator : "",
      additionalComments: text(fd.get("additionalComments"), 3000),
    };
  }
  const { biweeklySheets } = await cols();
  const res = await biweeklySheets.updateOne(
    { _id: sheet._id, updatedAt: sheet.updatedAt, status: { $ne: "COMPLETED" } },
    { $set: update, $push: { history: { at: new Date(), byId: user._id, action: staff ? "staff_edit" : "customer_edit" } } },
  );
  if (!res.matchedCount) return { error: "The report changed meanwhile. Reload the page and try again." };
  await audit(user._id, "biweekly.save", "biweekly", sheet._id, { periodStart: sheet.periodStart, before: { days: sheet.days, header: sheet.header }, after: { days, header: update.header ?? sheet.header } });
  refresh();
  return { ok: true, message: "Report saved." };
}

/** Customer (the student) or instructor signs the certification. Both signatures complete the report. */
export async function signBiweeklyAction(sheetId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  const found = await loadSheetFor(user, sheetId);
  if (!found) return NO_ACCESS;
  const { sheet } = found;
  if (sheet.status === "COMPLETED") return { error: "This report is already complete." };
  const asCustomer = user.role === "STUDENT" && sheet.studentId === user._id;
  if (!asCustomer && !isStaff(user)) return NO_ACCESS;
  const sig = signatureSchema.safeParse(String(fd.get("signature") ?? ""));
  if (!sig.success) return { fieldErrors: { signature: "Sign in the box" } };
  const signerName = String(fd.get("signerName") ?? "").trim().slice(0, 120);
  if (signerName.length < 2) return { fieldErrors: { signerName: "Type your full name" } };
  if (asCustomer && sheet.days.every((d) => !d.timeIn && !d.code)) return { error: "There's no attendance on this report yet." };
  const signature = { imageDataUrl: sig.data, signerName, signedAt: new Date(), signerId: user._id };
  const field = asCustomer ? "customerSignature" : "instructorSignature";
  const after = { ...sheet, [field]: { ...signature, dataHash: asCustomer ? customerContentHash(sheet) : biweeklyContentHash(sheet) } } as BiweeklyTimesheet;
  const status = after.customerSignature && after.instructorSignature ? "COMPLETED" : after.customerSignature ? "CUSTOMER_SIGNED" : "OPEN";
  const { biweeklySheets } = await cols();
  const res = await biweeklySheets.updateOne(
    { _id: sheet._id, updatedAt: sheet.updatedAt, status: { $ne: "COMPLETED" } },
    { $set: { [field]: after[field], status, updatedAt: new Date() }, $push: { history: { at: new Date(), byId: user._id, action: `${field}_signed` } } },
  );
  if (!res.matchedCount) return { error: "The report changed meanwhile. Reload the page and try again." };
  await audit(user._id, asCustomer ? "biweekly.customer_sign" : "biweekly.instructor_sign", "biweekly", sheet._id, { periodStart: sheet.periodStart, status });
  refresh();
  return { ok: true, message: status === "COMPLETED" ? "Signed. The report is complete." : "Signed." };
}

/** Admin reopens a completed report. The instructor signature is cleared; the audit log keeps it. */
export async function reopenBiweeklyAction(sheetId: string, _: ActionState): Promise<ActionState> {
  const user = await requireUser();
  if (user.role !== "ADMIN") return NO_ACCESS;
  const { biweeklySheets } = await cols();
  const sheet = await biweeklySheets.findOne({ _id: sheetId });
  if (!sheet || sheet.status !== "COMPLETED") return { error: "Only completed reports can be reopened." };
  await biweeklySheets.updateOne({ _id: sheet._id }, {
    $set: { instructorSignature: null, status: sheet.customerSignature ? "CUSTOMER_SIGNED" : "OPEN", updatedAt: new Date() },
    $push: { history: { at: new Date(), byId: user._id, action: "reopened" } },
  });
  await audit(user._id, "biweekly.reopen", "biweekly", sheet._id, { clearedInstructorSignature: sheet.instructorSignature });
  refresh();
  return { ok: true, message: "Report reopened. The instructor needs to sign it again." };
}
