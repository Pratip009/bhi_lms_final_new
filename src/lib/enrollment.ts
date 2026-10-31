import "server-only";
import type { Application, Category, County, EnrollmentType, NonPrivateProgram } from "@/db";
import { sha256 } from "@/lib/crypto";
import {
  categoryFor, documentsFor, schemaFor, templatesFor, SECTION_CATEGORY, SECTION_COURSE, SECTION_DOCUMENTS, type FormTemplate,
} from "@/lib/forms/templates";
import { formsBlockedByPayment, submitBlockedByPayment, type PaymentGate, paymentGate } from "@/lib/payment";

export const answersHash = (templateKey: string, data: Record<string, unknown>) =>
  sha256(`${templateKey}:${JSON.stringify(data, Object.keys(data).sort())}`);

export function openCorrection(app: Application) {
  const last = app.corrections.at(-1);
  return last && !last.resolvedAt ? last : null;
}

/** Which sections the student may change right now. */
export function editableSections(app: Application): "ALL" | Set<string> {
  if (app.status === "DRAFT") return "ALL";
  if (app.status === "CORRECTIONS_REQUESTED") return new Set(openCorrection(app)?.sections ?? []);
  return new Set();
}

export const canEdit = (editable: "ALL" | Set<string>, section: string) => editable === "ALL" || editable.has(section);

export type TemplateState = {
  template: FormTemplate; complete: boolean; signed: boolean; data: Record<string, unknown>; editedByAdmin: boolean;
};

export function enrollmentState(app: Application, gate: PaymentGate = paymentGate()) {
  const forms: TemplateState[] = templatesFor(app.category).map((t) => {
    const r = app.forms?.[t.key];
    const data = (r?.data ?? {}) as Record<string, unknown>;
    const complete = !!r?.completedAt && schemaFor(t).safeParse(data).success;
    const sig = app.signatures?.[t.key];
    // An admin correction after the student signed keeps the student's signature on record (the
    // before/after values are in the audit log), so the form still counts as signed.
    const editedByAdmin = !!r?.adminEditedAt;
    const signed = !t.requiresSignature || (!!sig && (sig.dataHash === answersHash(t.key, data) || editedByAdmin));
    return { template: t, complete, signed, data, editedByAdmin };
  });
  const requirements = documentsFor(app.category).map((req) => ({ req, files: app.documents.filter((d) => d.type === req.type) }));

  const missing: string[] = [];
  if (!app.category) missing.push("Choose Private or Non-Private (and your program)");
  if (app.category === "EQISS" && !app.county) missing.push("Choose your county (Hudson, Bergen or Somerset)");
  if (!app.courseId) missing.push("Choose your course");
  if (submitBlockedByPayment(app, gate)) missing.push("Pay your tuition and fees");
  for (const f of forms) {
    if (!f.complete) missing.push(`Complete "${f.template.title}"`);
    else if (!f.signed) missing.push(`Sign "${f.template.title}"`);
  }
  for (const r of requirements) if (r.req.required && r.files.length === 0) missing.push(`Upload your ${r.req.label.toLowerCase()}`);
  return { forms, requirements, missing, ready: missing.length === 0, formsLocked: formsBlockedByPayment(app, gate) };
}

export const ALL_SECTIONS = (app: Application) => [SECTION_CATEGORY, SECTION_COURSE, ...templatesFor(app.category).map((t) => t.key), SECTION_DOCUMENTS];

// ---------- Enrollment choice changes ----------

export { validateSelection, type Selection } from "@/lib/selection";
import type { Selection } from "@/lib/selection";

/**
 * The single update used when a student (or an admin) changes the enrollment choice. Answers,
 * signatures and files that don't belong to the new track (e.g. fee forms for a Non-Private student)
 * are removed in the same atomic update. Returns the files to delete from storage afterwards.
 */
export function selectionUpdate(app: Application, selection: Selection, category: Category) {
  const keep = new Set(templatesFor(category).map((t) => t.key));
  const keepDocs = new Set(documentsFor(category).map((d) => d.type));
  const unset: Record<string, ""> = {};
  // Only drop answers to templates of the current packet that the new track doesn't use. Answers kept
  // from older packet versions (legacy keys) stay on record.
  const currentKeys = new Set(templatesFor(app.category).map((t) => t.key));
  for (const k of Object.keys(app.forms ?? {})) if (currentKeys.has(k) && !keep.has(k)) unset[`forms.${k}`] = "";
  for (const k of Object.keys(app.signatures ?? {})) if (currentKeys.has(k) && !keep.has(k)) unset[`signatures.${k}`] = "";
  // Fee answers are never kept for a Non-Private track, whatever their key.
  if (category !== "PRIVATE") {
    for (const k of ["tuition", "refund", "private_agreement_1", "private_agreement_2", "refund_schedule"]) {
      if (app.forms?.[k]) unset[`forms.${k}`] = "";
      if (app.signatures?.[k]) unset[`signatures.${k}`] = "";
    }
  }
  const stale = app.documents.filter((d) => !keepDocs.has(d.type));
  const changedTrack = category !== app.category;
  const set: Record<string, unknown> = {
    category,
    enrollmentType: selection.enrollmentType,
    fundingProgram: selection.fundingProgram,
    county: selection.county,
    documents: app.documents.filter((d) => keepDocs.has(d.type)),
    updatedAt: new Date(),
  };
  if (changedTrack) {
    set.paymentStatus = category === "PRIVATE" ? "PENDING" : "NOT_REQUIRED";
    // Payment details are Private-only; never keep them on a Non-Private application.
    set.paymentReference = null;
    set.paymentReportedAt = null;
    set.paymentVerifiedAt = null;
    set.paymentVerifiedById = null;
  }
  return { set, unset, stale, changedTrack };
}
