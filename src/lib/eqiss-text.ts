/**
 * Wording for the EQISS / One-Stop biweekly report, from "Equus Timesheet - Updated 2026.docx".
 *
 * The title, the attendance symbols and the submission rule below are from that document. The two
 * certification statements were not available as text in this repository: paste them in exactly as
 * printed (leave them empty until then; the sheet shows only the signature lines, and admins see a
 * warning). Do not paraphrase.
 */
export const EQISS_TEXT = {
  title: "Customer Instructional Time, Attendance & Progress Biweekly Report — ITA Contract",
  symbols: "A — Absent, no hours. H — Holiday. S — Sick.",
  submission: "This report must be submitted within two business days after each two-week period, until the program end date.",
  customerCertification: "",
  instructorCertification: "",
};

export const eqissTextPending = () => !EQISS_TEXT.customerCertification || !EQISS_TEXT.instructorCertification;
