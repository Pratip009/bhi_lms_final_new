import { z } from "zod";
import type { Category, County, EnrollmentType, NonPrivateProgram } from "@/db/types";

/**
 * Enrollment packet definition, in the proposed online order from the BHI packets:
 *
 *   Common Forms (every student, defined once and reused):
 *     1. Student Data / Information        5. Workforce Registration Form
 *     2. Educational Background            6. Grievance Policy and Procedures
 *     3. Background Check Form             7. Photo Release Form
 *     4. Emergency Medical Statement
 *   (The Laptop Receipt Confirmation is signed in person when the laptop is collected, not online.)
 *   Private Forms:      Private Enrollment Agreement (page 1, page 2), Tuition Refund Schedule
 *   Non-Private Forms:  Non-Private Enrollment Agreement
 *
 * OFFICIAL WORDING: the photographed packets were not committed to this repository. Each template has
 * a `body` (paragraphs shown above the fields, exactly as printed) and `pendingOfficialText: true`
 * until the office's wording is pasted in. Do not paraphrase: copy the printed text, keep the field
 * labels, then set pendingOfficialText to false and bump `version`. Admins see a warning on their
 * dashboard while any template is still pending (see pendingTemplates()).
 *
 * Fee content: any template that shows tuition, payment or refund terms has containsFees: true. That
 * flag is what keeps it away from Non-Private students on screens, in saves and in PDFs.
 */

export type FieldType = "text" | "email" | "tel" | "date" | "textarea" | "select" | "checkbox";

export type Field = {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: string[];
  help?: string;
  maxLength?: number;
};

export type TemplateContext = { tuitionUsd: number };
export type TemplateGroup = "COMMON" | "PRIVATE" | "NON_PRIVATE";

export type FormTemplate = {
  key: string;
  title: string;
  version: number;
  group: TemplateGroup;
  appliesTo: Category[] | "ALL";
  /** Templates with fee/tuition/payment content. Never shown, stored or exported for Non-Private students. */
  containsFees: boolean;
  requiresSignature: boolean;
  /** Official printed text, one string per paragraph. */
  body?: string[];
  /** True until the official wording from the BHI packet has been pasted into `body` and `fields`. */
  pendingOfficialText: boolean;
  intro?: (ctx: TemplateContext) => string;
  fields: Field[];
};

// ---------- Enrollment choices ----------

export const ENROLLMENT_TYPE_LABELS: Record<EnrollmentType, string> = { PRIVATE: "Private", NON_PRIVATE: "Non-Private" };
export const PROGRAM_LABELS: Record<NonPrivateProgram, string> = { EQISS: "EQISS / One-Stop", DFS: "DFS (Department of Family Services)" };
export const COUNTY_LABELS: Record<County, string> = { HUDSON: "Hudson County", BERGEN: "Bergen County", SOMERSET: "Somerset County" };
export const COUNTIES: County[] = ["HUDSON", "BERGEN", "SOMERSET"];

export const CATEGORY_LABELS: Record<Category, string> = {
  PRIVATE: "Private",
  EQISS: "Non-Private: EQISS / One-Stop",
  DFS: "Non-Private: DFS",
};
export const CATEGORIES: Category[] = ["PRIVATE", "EQISS", "DFS"];

/** Non-Private (funded) tracks. These never see tuition, refund or payment content. */
export const FUNDED: Category[] = ["EQISS", "DFS"];
export const isFunded = (c: Category | null | undefined) => !!c && FUNDED.includes(c);

export function categoryFor(type: EnrollmentType | null | undefined, program: NonPrivateProgram | null | undefined): Category | null {
  if (type === "PRIVATE") return "PRIVATE";
  if (type === "NON_PRIVATE" && (program === "EQISS" || program === "DFS")) return program;
  return null;
}

/** One-line description, e.g. "Non-Private: EQISS / One-Stop, Bergen County". */
export function describeEnrollment(a: { category: Category | null; county?: County | null }): string {
  if (!a.category) return "Not selected";
  return a.category === "EQISS" && a.county ? `${CATEGORY_LABELS.EQISS}, ${COUNTY_LABELS[a.county]}` : CATEGORY_LABELS[a.category];
}

/** Which attendance sheet a track uses: EQISS = shared biweekly ITA report; DFS and Private = monthly handwritten sheet. */
export type AttendanceFormat = "BIWEEKLY" | "MONTHLY";
export const attendanceFormatFor = (c: Category | null | undefined): AttendanceFormat => (c === "EQISS" ? "BIWEEKLY" : "MONTHLY");

// ---------- Templates ----------

const ack = (title: string): Field => ({ name: "acknowledged", label: `I have read the ${title} and agree to its terms.`, type: "checkbox", required: true });

const tuitionIntro = ({ tuitionUsd }: TemplateContext) =>
  `Program tuition: ${tuitionUsd > 0 ? `$${tuitionUsd.toLocaleString("en-US")}` : "as stated in this agreement"}.`;

export const TEMPLATES: FormTemplate[] = [
  // ----- Common Forms -----
  {
    key: "student_data", title: "Student Data / Information", version: 1, group: "COMMON", appliesTo: "ALL",
    containsFees: false, requiresSignature: false, pendingOfficialText: true,
    fields: [
      { name: "legalName", label: "Full legal name", type: "text", required: true, maxLength: 120 },
      { name: "dateOfBirth", label: "Date of birth", type: "date", required: true },
      { name: "phone", label: "Phone number", type: "tel", required: true, maxLength: 30 },
      { name: "street", label: "Street address", type: "text", required: true, maxLength: 160 },
      { name: "city", label: "City", type: "text", required: true, maxLength: 80 },
      { name: "state", label: "State", type: "text", required: true, maxLength: 40 },
      { name: "zip", label: "ZIP code", type: "text", required: true, maxLength: 10 },
    ],
  },
  {
    key: "educational_background", title: "Educational Background", version: 1, group: "COMMON", appliesTo: "ALL",
    containsFees: false, requiresSignature: false, pendingOfficialText: true,
    fields: [
      {
        name: "highestEducation", label: "Highest education completed", type: "select", required: true,
        options: ["Some high school", "High school diploma / GED", "Some college", "Associate degree", "Bachelor's degree", "Graduate degree"],
      },
      { name: "lastSchool", label: "Last school attended", type: "text", maxLength: 160 },
    ],
  },
  {
    key: "background_check", title: "Background Check Form", version: 1, group: "COMMON", appliesTo: "ALL",
    containsFees: false, requiresSignature: true, pendingOfficialText: true,
    fields: [ack("Background Check Form")],
  },
  {
    key: "emergency_medical", title: "Emergency Medical Statement", version: 1, group: "COMMON", appliesTo: "ALL",
    containsFees: false, requiresSignature: true, pendingOfficialText: true,
    fields: [
      { name: "contactName", label: "Emergency contact name", type: "text", required: true, maxLength: 120 },
      { name: "relationship", label: "Relationship", type: "text", required: true, maxLength: 60 },
      { name: "contactPhone", label: "Emergency contact phone", type: "tel", required: true, maxLength: 30 },
      ack("Emergency Medical Statement"),
    ],
  },
  {
    key: "workforce_registration", title: "Workforce Registration Form", version: 1, group: "COMMON", appliesTo: "ALL",
    containsFees: false, requiresSignature: true, pendingOfficialText: true,
    fields: [ack("Workforce Registration Form")],
  },
  {
    key: "grievance_policy", title: "Grievance Policy and Procedures", version: 1, group: "COMMON", appliesTo: "ALL",
    containsFees: false, requiresSignature: true, pendingOfficialText: true,
    fields: [ack("Grievance Policy and Procedures")],
  },
  {
    key: "photo_release", title: "Photo Release Form", version: 1, group: "COMMON", appliesTo: "ALL",
    containsFees: false, requiresSignature: true, pendingOfficialText: true,
    fields: [{ name: "photoRelease", label: "Photo release", type: "select", required: true, options: ["I give permission", "I do not give permission"] }],
  },

  // ----- Private Forms -----
  {
    key: "private_agreement_1", title: "Private Enrollment Agreement (page 1)", version: 1, group: "PRIVATE", appliesTo: ["PRIVATE"],
    containsFees: true, requiresSignature: true, pendingOfficialText: true, intro: tuitionIntro,
    fields: [ack("Private Enrollment Agreement (page 1)")],
  },
  {
    key: "private_agreement_2", title: "Private Enrollment Agreement (page 2)", version: 1, group: "PRIVATE", appliesTo: ["PRIVATE"],
    containsFees: true, requiresSignature: true, pendingOfficialText: true,
    fields: [ack("Private Enrollment Agreement (page 2)")],
  },
  {
    key: "refund_schedule", title: "Tuition Refund Schedule", version: 1, group: "PRIVATE", appliesTo: ["PRIVATE"],
    containsFees: true, requiresSignature: true, pendingOfficialText: true,
    fields: [ack("Tuition Refund Schedule")],
  },

  // ----- Non-Private Forms -----
  {
    key: "nonprivate_agreement", title: "Non-Private Enrollment Agreement", version: 1, group: "NON_PRIVATE", appliesTo: ["EQISS", "DFS"],
    containsFees: false, requiresSignature: true, pendingOfficialText: true,
    fields: [ack("Non-Private Enrollment Agreement")],
  },
];

export const GROUP_LABELS: Record<TemplateGroup, string> = { COMMON: "Common Forms", PRIVATE: "Private Forms", NON_PRIVATE: "Non-Private Forms" };

/**
 * Templates for a category. Fee templates are removed for any Non-Private category even if
 * misconfigured above: this is the core guarantee that funded students never see fees.
 */
export function templatesFor(category: Category | null | undefined): FormTemplate[] {
  if (!category) return [];
  return TEMPLATES.filter(
    (t) => (t.appliesTo === "ALL" || t.appliesTo.includes(category)) && (category === "PRIVATE" || !t.containsFees),
  );
}

export function getTemplate(key: string, category: Category | null | undefined): FormTemplate | undefined {
  return templatesFor(category).find((t) => t.key === key);
}

/** Templates still waiting for the official wording (shown as a warning to admins). */
export const pendingTemplates = () => TEMPLATES.filter((t) => t.pendingOfficialText);

/** Zod schema built from a template's fields. Unknown keys are stripped. */
export function schemaFor(t: FormTemplate) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const f of t.fields) {
    if (f.type === "checkbox") {
      shape[f.name] = f.required
        ? z.boolean().refine((v) => v === true, "Please confirm to continue")
        : z.boolean().default(false);
      continue;
    }
    const max = f.maxLength ?? 500;
    shape[f.name] = z
      .string()
      .trim()
      .max(max, `Use at most ${max} characters`)
      .superRefine((v, ctx) => {
        if (!v) {
          if (f.required) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "This field is required" });
          return;
        }
        if (f.type === "email" && !z.string().email().safeParse(v).success)
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter a valid email address" });
        if (f.type === "date" && (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))))
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter a valid date" });
        if (f.type === "select" && f.options && !f.options.includes(v))
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Choose one of the options" });
      });
  }
  return z.object(shape).strip();
}

/** Parses FormData-like raw input into typed answers. */
export function coerceRaw(t: FormTemplate, raw: Record<string, FormDataEntryValue | undefined>) {
  const out: Record<string, unknown> = {};
  for (const f of t.fields) {
    const v = raw[f.name];
    out[f.name] = f.type === "checkbox" ? v === "on" || v === "true" : typeof v === "string" ? v : "";
  }
  return out;
}

// ---------- Documents ----------

export type DocumentRequirement = { type: string; label: string; required: boolean; appliesTo: Category[] | "ALL"; help?: string };

/**
 * Supporting uploads (checklist items, not photographed forms). Whether the Social Security card copy
 * is mandatory, and the Inter-Agency Referral / Status Change Form itself, are open questions for BHI;
 * both are optional uploads until confirmed.
 */
export const DOCUMENTS: DocumentRequirement[] = [
  { type: "RESUME", label: "Resume", required: true, appliesTo: "ALL", help: "PDF or Word document" },
  { type: "PHOTO_ID", label: "Government-issued photo ID", required: true, appliesTo: "ALL", help: "PDF, JPG or PNG" },
  { type: "SSN_CARD", label: "Social Security card copy", required: false, appliesTo: "ALL", help: "PDF, JPG or PNG. Only BHI staff can view it." },
  { type: "REFERRAL", label: "Inter-Agency Referral / Status Change Form", required: false, appliesTo: ["EQISS", "DFS"], help: "If your agency gave you one" },
];

export const documentsFor = (c: Category | null | undefined) =>
  c ? DOCUMENTS.filter((d) => d.appliesTo === "ALL" || d.appliesTo.includes(c)) : [];

export const SECTION_DOCUMENTS = "documents";
export const SECTION_CATEGORY = "category";
export const SECTION_COURSE = "course";

/** Human labels for correction sections. */
export function sectionLabel(key: string): string {
  if (key === SECTION_DOCUMENTS) return "Documents and resume";
  if (key === SECTION_CATEGORY) return "Enrollment type and program";
  if (key === SECTION_COURSE) return "Course selection";
  return TEMPLATES.find((t) => t.key === key)?.title ?? key;
}
