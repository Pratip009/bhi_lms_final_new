"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { cols, newId, isDuplicateKey, type AttendanceStatus } from "@/db";
import { requireInstructor } from "@/lib/auth";
import { assertCanManageClass, getVisibleEnrollment, ForbiddenError } from "@/lib/authz";
import { audit } from "@/lib/audit";
import { invalid, type ActionState } from "@/lib/action";
import { REPORT_FIELDS, REPORT_TEMPLATE, monthSchema, reportSchema } from "@/lib/reports/template";
import { thisMonthLocal } from "@/lib/dates";
import { attendanceChanges, dateProblem } from "@/lib/attendance-rules";

const STATUSES: AttendanceStatus[] = ["PRESENT", "ABSENT", "LATE", "EXCUSED", "HOLIDAY"];

export async function recordAttendanceAction(classId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireInstructor();
  try {
    await assertCanManageClass(user, classId);
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: e.message };
    throw e;
  }
  const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).safeParse(fd.get("date"));
  if (!date.success) return { error: "Choose a valid date." };
  const { classes, enrollments, classSessions } = await cols();
  const klass = await classes.findOne({ _id: classId });
  if (!klass) return { error: "Class not found." };
  const problem = dateProblem(klass, date.data, user.role);
  if (problem) return { error: problem };

  // Only active enrollments of this class can be marked; ids from the form are matched against this list.
  const roster = await enrollments.find({ classId, status: "ACTIVE" }, { projection: { _id: 1 } }).toArray();
  const before = await classSessions.findOne({ classId, date: date.data }, { projection: { records: 1 } });
  const set: Record<string, unknown> = {};
  const marks: Record<string, { status: AttendanceStatus; hours: number; note: string }> = {};
  const errors: Record<string, string> = {};
  const now = new Date();
  let submitted = 0;
  for (const { _id: id } of roster) {
    const status = fd.get(`status_${id}`);
    if (!status) continue; // not marked; leave as is
    if (!STATUSES.includes(status as AttendanceStatus)) { errors[`status_${id}`] = "Invalid status"; continue; }
    const hours = Number(fd.get(`hours_${id}`) ?? 0);
    if (!Number.isFinite(hours) || hours < 0 || hours > 24) { errors[`hours_${id}`] = "0 to 24"; continue; }
    const mark = { status: status as AttendanceStatus, hours: Math.round(hours * 100) / 100, note: String(fd.get(`note_${id}`) ?? "").trim().slice(0, 300) };
    submitted++;
    // Rows that didn't change are left alone, so saving the sheet during class never takes over a
    // student's check-in (they can still fill out the day) and the audit log only shows real changes.
    const prev = before?.records[id];
    if (prev && prev.status === mark.status && Number(prev.hours) === mark.hours && (prev.note ?? "") === mark.note) continue;
    marks[id] = mark;
    const minutes = Math.round(mark.hours * 60);
    // Field-by-field so handwritten times and the student's signature on the same day are kept.
    for (const [k, v] of Object.entries({ ...mark, minutes, source: "INSTRUCTOR", recordedById: user._id, updatedAt: now })) set[`records.${id}.${k}`] = v;
  }
  if (Object.keys(errors).length) return { error: "Fix the highlighted rows.", fieldErrors: errors };
  const count = Object.keys(marks).length;
  if (!submitted) return { error: "Mark at least one student." };
  if (!count) return { ok: true, message: "Nothing changed." };

  const changes = attendanceChanges(before?.records, marks);

  // One document per class and date (unique index); a single upsert writes all marks at once.
  const upsert = () =>
    classSessions.updateOne(
      { classId, date: date.data },
      { $set: set, $setOnInsert: { _id: newId(), classId, date: date.data, createdAt: now } },
      { upsert: true },
    );
  try {
    await upsert();
  } catch (e) {
    if (!isDuplicateKey(e)) throw e;
    await upsert(); // two people saved the same new date at once; the second write now updates
  }
  await audit(user._id, "attendance.record", "class", classId, { date: date.data, count, changes });
  revalidatePath(`/instructor/classes/${classId}`, "layout");
  return { ok: true, message: `Attendance saved for ${date.data} (${count} students).` };
}

const reportSignature = z.string().regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/).max(300_000);

/**
 * Saves a draft or submits the Monthly Student Progress Report. Submitting needs the lesson number(s),
 * comments and the instructor's signature. Each save keeps the previous version in `revisions`.
 */
export async function saveReportAction(enrollmentId: string, month: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireInstructor();
  let enrollment;
  try {
    enrollment = await getVisibleEnrollment(user, enrollmentId);
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: e.message };
    throw e;
  }
  if (!monthSchema.safeParse(month).success || month > thisMonthLocal()) return { error: "Invalid month." };
  const submit = fd.get("intent") === "submit";
  const raw = Object.fromEntries(REPORT_FIELDS.map((f) => [f.name, String(fd.get(f.name) ?? "")]));
  const parsed = reportSchema(submit).safeParse(raw);
  if (!parsed.success) return invalid(parsed.error);

  const { progressReports } = await cols();
  const existing = await progressReports.findOne({ enrollmentId: enrollment._id, month });
  if (existing?.status === "SUBMITTED") return { error: "This report was already submitted. Ask an admin to reopen it." };

  const now = new Date();
  let signature = existing?.signature ?? null;
  const sigInput = String(fd.get("signature") ?? "");
  if (sigInput) {
    const sig = reportSignature.safeParse(sigInput);
    const signerName = String(fd.get("signerName") ?? "").trim().slice(0, 120);
    if (!sig.success) return { fieldErrors: { signature: "Sign in the box" } };
    if (signerName.length < 2) return { fieldErrors: { signerName: "Type your full name" } };
    signature = { imageDataUrl: sig.data, signerName, signedAt: now, signerId: user._id };
  }
  // A signature always belongs to the instructor submitting; a draft signed by someone else must be re-signed.
  if (submit && (!signature || signature.signerId !== user._id)) return { error: "Sign the report to submit it.", fieldErrors: { signature: "Instructor signature required" } };

  const values = {
    data: parsed.data as Record<string, unknown>,
    templateVersion: REPORT_TEMPLATE.version,
    status: submit ? ("SUBMITTED" as const) : ("DRAFT" as const),
    submittedAt: submit ? now : null,
    authorId: user._id,
    instructorName: user.name,
    signature,
    updatedAt: now,
  };
  if (existing) {
    const revision = { data: existing.data, status: existing.status, signature: existing.signature ?? null, authorId: existing.authorId, instructorName: existing.instructorName, savedAt: existing.updatedAt };
    // Conditional on the version we read, so two saves at once can't silently overwrite each other.
    const res = await progressReports.updateOne(
      { _id: existing._id, status: "DRAFT", updatedAt: existing.updatedAt },
      { $set: values, $push: { revisions: revision } },
    );
    if (!res.matchedCount) return { error: "The report changed meanwhile. Reload the page and try again." };
  } else {
    try {
      await progressReports.insertOne({ _id: newId(), enrollmentId: enrollment._id, month, revisions: [], ...values });
    } catch (e) {
      if (isDuplicateKey(e)) return { error: "The report was just created by someone else. Reload the page." };
      throw e;
    }
  }
  await audit(user._id, submit ? "report.submit" : "report.save_draft", "enrollment", enrollment._id, { month });
  revalidatePath("/instructor", "layout");
  revalidatePath("/admin", "layout");
  return { ok: true, message: submit ? "Report submitted. Admins can now see it." : "Draft saved." };
}
