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

// Daily attendance is saved by saveDayAction (src/lib/actions/daily.ts), shared by instructors and admins.

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
