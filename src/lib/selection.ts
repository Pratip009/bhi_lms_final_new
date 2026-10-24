// Pure validation of the enrollment choice (no DB) so it can be unit-tested.
import type { Category, County, EnrollmentType, NonPrivateProgram } from "@/db/types";
import { categoryFor } from "@/lib/forms/templates";

export type Selection = { enrollmentType: EnrollmentType; fundingProgram: NonPrivateProgram | null; county: County | null };

/** Validates the student's choice. Returns the derived category or a field error. */
export function validateSelection(s: { enrollmentType?: string | null; fundingProgram?: string | null; county?: string | null }):
  { ok: true; selection: Selection; category: Category } | { ok: false; field: string; message: string } {
  const type = s.enrollmentType === "PRIVATE" || s.enrollmentType === "NON_PRIVATE" ? s.enrollmentType : null;
  if (!type) return { ok: false, field: "enrollmentType", message: "Choose Private or Non-Private" };
  if (type === "PRIVATE") return { ok: true, selection: { enrollmentType: "PRIVATE", fundingProgram: null, county: null }, category: "PRIVATE" };
  const program = s.fundingProgram === "EQISS" || s.fundingProgram === "DFS" ? s.fundingProgram : null;
  if (!program) return { ok: false, field: "fundingProgram", message: "Choose EQISS / One-Stop or DFS" };
  if (program === "DFS") return { ok: true, selection: { enrollmentType: "NON_PRIVATE", fundingProgram: "DFS", county: null }, category: "DFS" };
  const county = s.county === "HUDSON" || s.county === "BERGEN" || s.county === "SOMERSET" ? s.county : null;
  if (!county) return { ok: false, field: "county", message: "Choose Hudson, Bergen or Somerset County" };
  return { ok: true, selection: { enrollmentType: "NON_PRIVATE", fundingProgram: "EQISS", county }, category: categoryFor("NON_PRIVATE", "EQISS")! };
}

