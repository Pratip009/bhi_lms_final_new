import { z } from "zod";

/**
 * Monthly Student Progress Report, from "Student Progress Report Template.docx":
 *   Student Progress Report — Student name, Instructor, Month, Year, Lesson(s) number, Comments, Instructor Signature.
 * Student name, instructor, month and year are filled in from the record; the instructor enters the
 * lesson number(s) and comments, then signs. No other fields are added.
 *
 * Version 1 (placeholder fields used before the template was received) is kept only to display
 * reports written with it.
 */
export type ReportField = { name: string; label: string; type: "select" | "textarea" | "text"; options?: string[]; required: boolean; maxLength: number };

export const REPORT_TEMPLATE: { version: number; title: string; fields: ReportField[] } = {
  version: 2,
  title: "Student Progress Report",
  fields: [
    { name: "lessons", label: "Lesson(s) number", type: "text", required: true, maxLength: 200 },
    { name: "comments", label: "Comments", type: "textarea", required: true, maxLength: 5000 },
  ],
};

const LEGACY_V1: ReportField[] = [
  { name: "participation", label: "Participation", type: "select", required: false, maxLength: 3000 },
  { name: "attendanceNotes", label: "Attendance notes", type: "textarea", required: false, maxLength: 3000 },
  { name: "skillsProgress", label: "Skills progress this month", type: "textarea", required: false, maxLength: 3000 },
  { name: "strengths", label: "Strengths", type: "textarea", required: false, maxLength: 3000 },
  { name: "areasToImprove", label: "Areas to improve", type: "textarea", required: false, maxLength: 3000 },
  { name: "goals", label: "Goals for next month", type: "textarea", required: false, maxLength: 3000 },
  { name: "instructorComments", label: "Instructor comments", type: "textarea", required: false, maxLength: 3000 },
];

export const REPORT_FIELDS = REPORT_TEMPLATE.fields;
export const reportFieldsFor = (version: number) => (version >= 2 ? REPORT_TEMPLATE.fields : LEGACY_V1);

export function reportSchema(submit: boolean) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const f of REPORT_FIELDS) {
    shape[f.name] = z
      .string()
      .trim()
      .max(f.maxLength, `Use at most ${f.maxLength} characters`)
      .superRefine((v, ctx) => {
        if (submit && f.required && !v) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Required to submit" });
      });
  }
  return z.object(shape).strip();
}

export const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Invalid month");

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** "2026-10" → { month: "October", year: "2026" } as written on the form. */
export const monthParts = (ym: string) => ({ month: MONTHS[Number(ym.slice(5, 7)) - 1] ?? "", year: ym.slice(0, 4) });
