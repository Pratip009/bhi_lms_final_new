import { z } from "zod";
import type { Category, County, CourseFees, EnrollmentType, NonPrivateProgram } from "@/db/types";

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

/**
 * Field types. "heading" and "note" only display text (no answer is stored). "radio" is one choice,
 * "multi" is "check all that apply" (stored as a list), "ssn" is a Social Security number (shown masked
 * on review screens).
 */
export type FieldType = "text" | "email" | "tel" | "date" | "textarea" | "select" | "checkbox" | "radio" | "multi" | "ssn" | "heading" | "note";

export type Field = {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: string[];
  help?: string;
  maxLength?: number;
  /** Pre-fills an empty field: "name" / "email" (the account) or "<formKey>.<field>" (an earlier form). */
  prefill?: string;
};

/** What a form's text can refer to: the student's name and, for Private forms, the chosen course and its fees. */
export type TemplateContext = {
  studentName: string;
  course: { name: string; fees: CourseFees | null } | null;
};
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
  /** Official printed text above the fields, one string per paragraph (a function when it uses the student's name or course). */
  body?: string[] | ((ctx: TemplateContext) => string[]);
  /** True until the official wording from the BHI packet has been entered. */
  pendingOfficialText: boolean;
  fields: Field[];
  /** Rules across fields, e.g. "explain" is required when a question is answered Yes. Returns field errors. */
  check?: (data: Record<string, unknown>) => Record<string, string>;
};

/** Fields that hold an answer (headings and notes don't). */
export const isInput = (f: Field) => f.type !== "heading" && f.type !== "note";
export const inputFields = (t: FormTemplate) => t.fields.filter(isInput);
export const bodyOf = (t: FormTemplate, ctx: TemplateContext): string[] => (typeof t.body === "function" ? t.body(ctx) : t.body ?? []);

const usd = (cents: number | undefined) => (cents ? (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 }) : "0");
export const feesTotalCents = (f: CourseFees | null | undefined) => (f ? f.tuitionCents + f.feesCents + f.booksCents + f.toolsCents + f.otherCents : 0);

/** How an answer is shown on review screens and in the packet. */
export function displayValue(f: Field, v: unknown, opts: { revealSsn?: boolean } = {}): string {
  if (f.type === "checkbox") return v === true ? "Yes" : "No";
  if (f.type === "multi") return Array.isArray(v) && v.length ? v.join(", ") : "";
  if (f.type === "ssn" && typeof v === "string" && v && !opts.revealSsn) return `***-**-${v.slice(-4)}`;
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

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
// Wording and fields are transcribed from "BHI Common Forms" and "BHI Private Forms" (photographed
// paper packets). Text is kept as printed, including its spelling. Where the paper leaves a blank for
// the school's or the student's name, the name is filled in.

const YES_NO = ["Yes", "No"];
const SIGN_DATE_NOTE = "Your signature and today's date are recorded when you sign below.";
const QUESTIONS: Field = { name: "questionsComments", label: "Questions or comments (on paper: \"please write any questions or comments you have on the back of this sheet\")", type: "textarea", maxLength: 2000 };

/** "Explain" becomes required when any of the listed questions is answered Yes. */
const explainIfYes = (questions: string[], explain: string) => (d: Record<string, unknown>): Record<string, string> =>
  questions.some((q) => d[q] === "Yes") && !String(d[explain] ?? "").trim() ? { [explain]: "Please explain, because you answered Yes" } : {};

const yn = (name: string, label: string, required = true): Field => ({ name, label, type: "radio", options: YES_NO, required });

export const TEMPLATES: FormTemplate[] = [
  // ----- Common Forms -----
  {
    key: "student_data", title: "Student Data", version: 2, group: "COMMON", appliesTo: "ALL",
    containsFees: false, requiresSignature: true, pendingOfficialText: false,
    fields: [
      { name: "orientation", label: "There is a mandatory orientation scheduled before the first day of class and I agree to make myself available.", type: "checkbox", required: true },
      { name: "legalName", label: "Name", type: "text", required: true, maxLength: 120, prefill: "name" },
      { name: "dateOfBirth", label: "DOB", type: "date", required: true },
      { name: "ssn", label: "Soc. Sec", type: "ssn", required: true },
      { name: "h_address", label: "Permanent Address:", type: "heading" },
      { name: "street", label: "Street address", type: "text", required: true, maxLength: 160 },
      { name: "city", label: "City", type: "text", required: true, maxLength: 80 },
      { name: "state", label: "State", type: "text", required: true, maxLength: 40 },
      { name: "zip", label: "ZIP code", type: "text", required: true, maxLength: 10 },
      { name: "cellPhone", label: "CELL Phone", type: "tel", required: true, maxLength: 30 },
      { name: "homePhone", label: "HOME Phone", type: "tel", maxLength: 30 },
      { name: "workPhone", label: "WORK Phone", type: "tel", maxLength: 30 },
      { name: "email", label: "Email Address:", type: "email", required: true, maxLength: 160, prefill: "email" },
      { name: "gender", label: "Gender:", type: "text", maxLength: 40 },
      { name: "ethnicity", label: "Ethnicity:", type: "text", maxLength: 80 },
      { name: "h_social", label: "Social Media (Optional)", type: "heading" },
      { name: "n_social", label: "Please be advised we would like to stay in touch with you at all times as well as use every angle we to make you more marketable in the industry of choice.", type: "note" },
      { name: "facebook", label: "Facebook:", type: "text", maxLength: 200 },
      { name: "twitter", label: "Twitter:", type: "text", maxLength: 200 },
      { name: "linkedin", label: "Linkedin:", type: "text", maxLength: 200 },
      { name: "h_release", label: "Job Placement-information Release Authorization", type: "heading" },
      {
        name: "n_release", type: "note",
        label: "I, the undersigned, hereby authorize my employer, to release any and all information relating to my employment with them to Bright Horizon Institute. I further release and hold harmless the parties involved (current employer and Bright Horizon Institute) from any and all liability that may potentially result from the release and/or use of such information. I understand that any information released by my employer will be held in strictest confidence, that it will be viewed only by the perspective parties needed, and that neither I nor anyone else not so involved will have the right to see the information.",
      },
      QUESTIONS,
    ],
  },
  {
    key: "educational_background", title: "Educational Background", version: 2, group: "COMMON", appliesTo: "ALL",
    containsFees: false, requiresSignature: false, pendingOfficialText: false,
    fields: [
      { name: "highSchoolName", label: "High School Name", type: "text", maxLength: 160 },
      { name: "highSchoolAddress", label: "Address:", type: "textarea", maxLength: 400 },
      { name: "highSchoolYear", label: "Year Completed:", type: "text", maxLength: 10 },
      yn("hsDiploma", "Did you achieve your High School diploma?"),
      yn("hasGed", "Do you have a G.E.D.? (Only if it applies)", false),
      yn("seekingGed", "Are you currently seeking to get your G.E.D?", false),
      { name: "tabeReading", label: "T.A.B.E. test grade: Reading level", type: "text", maxLength: 40 },
      { name: "tabeMath", label: "Math Level", type: "text", maxLength: 40 },
      { name: "h_college", label: "Previous College Information", type: "heading" },
      { name: "collegeName", label: "School Name:", type: "text", maxLength: 160 },
      {
        name: "degree", label: "Degree: (Please check one)", type: "radio",
        options: ["Associate", "Bachelor's (of Science, of Arts, of fine arts, of administration, of architecture)", "Masters", "Certificate of Completion"],
      },
      { name: "collegeAddress", label: "School Address:", type: "textarea", maxLength: 400 },
      { name: "collegeYear", label: "Year Completed:", type: "text", maxLength: 10 },
      { name: "h_payment", label: "Payment information:", type: "heading" },
      { name: "fundingPlan", label: "How do you plan to fund your education?", type: "textarea", required: true, maxLength: 1000 },
      { name: "workforceFunding", label: "Will you be seeking funding from workforce?", type: "radio", options: ["YES", "NO"], required: true },
      { name: "metCounselor", label: "Have you met with a Counselor at Workforce/Social Services?", type: "radio", options: ["YES", "NO"], required: true },
      { name: "tour", label: "Have you received a tour of our Facility?", type: "radio", options: ["YES", "NO"], required: true },
    ],
  },
  {
    key: "background_check", title: "Background Check Form", version: 2, group: "COMMON", appliesTo: "ALL",
    containsFees: false, requiresSignature: true, pendingOfficialText: false,
    body: ["All information will be kept strictly confidential."],
    fields: [
      { name: "firstName", label: "Name: First", type: "text", required: true, maxLength: 80 },
      { name: "middleName", label: "Middle", type: "text", maxLength: 80 },
      { name: "lastName", label: "Last", type: "text", required: true, maxLength: 80 },
      { name: "street", label: "Address: Street", type: "text", required: true, maxLength: 160, prefill: "student_data.street" },
      { name: "city", label: "City", type: "text", required: true, maxLength: 80, prefill: "student_data.city" },
      { name: "state", label: "State", type: "text", required: true, maxLength: 40, prefill: "student_data.state" },
      { name: "zip", label: "Zip", type: "text", required: true, maxLength: 10, prefill: "student_data.zip" },
      { name: "otherNames", label: "Maiden Name or Other Names Used", type: "text", maxLength: 160 },
      { name: "dateOfBirth", label: "Date of Birth", type: "date", required: true, prefill: "student_data.dateOfBirth" },
      { name: "ssn", label: "Social Security #", type: "ssn", required: true, prefill: "student_data.ssn" },
      yn("arrested", "Have you ever been arrested or convicted for any criminal offense excluding minor traffic violations?"),
      yn("abuse", "Have you ever been accused, arrested or convicted of abuse or sexually related crimes?"),
      yn("lifestyle", "Is there anything in your life-style or background that would call into question your ability?"),
      { name: "explain", label: "If you answered yes to any of these questions, please explain:", type: "textarea", maxLength: 2000 },
      { name: "n_yes", label: "Please note: answering \"yes\" to any of these questions does not automatically disqualify you. Please use the spaces provided to explain the circumstances.", type: "note" },
      { name: "expungement", label: "Have your previously or are you currently seeking for your expungement for your records? If so where in the process are you? If not please explain why", type: "textarea", maxLength: 2000 },
      {
        name: "n_authorize", type: "note",
        label: "I hereby authorize Bright Horizon Institute to make an independent investigation of my background and criminal or police records. I release Bright Horizon Institute, and any person or entity which provides information pursuant to this authorization, from any and all liabilities, claims or law suits in regards to the information obtained from any and all of the above sources. The information contained in this application is correct to the best of my knowledge. I understand that any omission of material fact on this application may be grounds for rejection of this application.",
      },
      QUESTIONS,
    ],
    check: explainIfYes(["arrested", "abuse", "lifestyle"], "explain"),
  },
  {
    key: "emergency_medical", title: "Emergency Medical Statement", version: 2, group: "COMMON", appliesTo: "ALL",
    containsFees: false, requiresSignature: true, pendingOfficialText: false,
    fields: [
      { name: "h_emergency", label: "EMERGENCY INFORMATION:", type: "heading" },
      { name: "n_emergency", label: "In case of emergency, whom should we contact?", type: "note" },
      { name: "contact1Name", label: "1) Name:", type: "text", required: true, maxLength: 120 },
      { name: "contact1Relationship", label: "Relationship:", type: "text", required: true, maxLength: 60 },
      { name: "contact1Phone", label: "Tel#", type: "tel", required: true, maxLength: 30 },
      { name: "contact2Name", label: "2) Name:", type: "text", maxLength: 120 },
      { name: "contact2Relationship", label: "Relationship:", type: "text", maxLength: 60 },
      { name: "contact2Phone", label: "Tel#", type: "tel", maxLength: 30 },
      { name: "physicianName", label: "Name of family Physician:", type: "text", maxLength: 120 },
      { name: "physicianPhone", label: "Tel#", type: "tel", maxLength: 30 },
      { name: "h_medical", label: "MEDICAL INFORMATION", type: "heading" },
      { name: "n_medical", label: "Have you ever had or do you have?", type: "note" },
      yn("vision", "Vision Problem"),
      yn("bloodPressure", "H/L Blood Pressure"),
      yn("hearing", "Hearing Problem"),
      yn("diabetes", "Diabetes"),
      yn("dizziness", "Dizziness/ Fainting"),
      yn("epilepsy", "Epilepsy/ Seizures"),
      yn("learning", "Learning Disorder"),
      yn("asthma", "Asthma"),
      { name: "otherCondition", label: "Other (specify)", type: "text", maxLength: 200 },
      { name: "conditionsExplain", label: "If you have answered yes to any of the above please explain", type: "textarea", maxLength: 2000 },
      yn("reaction", "Have you ever had or do you have a reaction to serum, drugs, or any medicines (aspirin/ penicillin)?"),
      { name: "reactionExplain", label: "If yes please explain", type: "textarea", maxLength: 1000 },
      yn("medicines", "Are you taking any medicines now?"),
      { name: "medicinesExplain", label: "If yes explain", type: "textarea", maxLength: 1000 },
      yn("infections", "Do you have any infections/ diseases?"),
      { name: "infectionsExplain", label: "If yes explain", type: "textarea", maxLength: 1000 },
    ],
    check: (d) => ({
      ...explainIfYes(["vision", "bloodPressure", "hearing", "diabetes", "dizziness", "epilepsy", "learning", "asthma"], "conditionsExplain")(d),
      ...explainIfYes(["reaction"], "reactionExplain")(d),
      ...explainIfYes(["medicines"], "medicinesExplain")(d),
      ...explainIfYes(["infections"], "infectionsExplain")(d),
    }),
  },
  {
    key: "workforce_registration", title: "Workforce New Jersey Customer Registration Form", version: 2, group: "COMMON", appliesTo: "ALL",
    containsFees: false, requiresSignature: true, pendingOfficialText: false,
    fields: [
      { name: "todaysDate", label: "1. Today's Date", type: "date", required: true },
      { name: "ssn", label: "2. Social Security Number", type: "ssn", required: true, prefill: "student_data.ssn" },
      { name: "dateOfBirth", label: "3. Date of Birth", type: "date", required: true, prefill: "student_data.dateOfBirth" },
      { name: "gender", label: "4. Gender", type: "radio", options: ["Male", "Female"] },
      { name: "lastName", label: "Last Name", type: "text", required: true, maxLength: 80, prefill: "background_check.lastName" },
      { name: "firstName", label: "First Name", type: "text", required: true, maxLength: 80, prefill: "background_check.firstName" },
      { name: "middleInitial", label: "Middle Initial", type: "text", maxLength: 2 },
      { name: "street", label: "6. Street", type: "text", required: true, maxLength: 160, prefill: "student_data.street" },
      { name: "city", label: "7. City", type: "text", required: true, maxLength: 80, prefill: "student_data.city" },
      { name: "state", label: "8. State", type: "text", required: true, maxLength: 40, prefill: "student_data.state" },
      { name: "zip", label: "9. Zip", type: "text", required: true, maxLength: 10, prefill: "student_data.zip" },
      { name: "county", label: "10. County", type: "text", maxLength: 60 },
      { name: "phone", label: "11. Phone Number", type: "tel", required: true, maxLength: 30, prefill: "student_data.cellPhone" },
      { name: "altPhone", label: "12. Alternate Phone Number", type: "tel", maxLength: 30 },
      { name: "fax", label: "13. Fax Number", type: "tel", maxLength: 30 },
      { name: "email", label: "14. Email", type: "email", maxLength: 160, prefill: "email" },
      yn("usCitizen", "15. US Citizen?"),
      { name: "alienReg", label: "Alien Reg. #", type: "text", maxLength: 40 },
      { name: "alienExpiration", label: "Expiration Date", type: "date" },
      { name: "h_16", label: "16. What is your ethnic heritage?", type: "heading" },
      yn("hispanic", "Are you Hispanic or Latino?", false),
      { name: "race", label: "Please ✓ all that apply below:", type: "multi", options: ["White", "Black or African American", "Alaskan/American Indian", "Asian", "Hawaiian/Pacific Islander", "I choose not to respond"] },
      {
        name: "schoolStatus", label: "17. School Status: (✓ One)", type: "radio", required: true,
        options: ["In-School, H.S. or Less", "In-School, Alternate School", "In-School Post H.S.", "Not Attending School; Did not finish High School", "Not Attending School; H.S. Graduate"],
      },
      { name: "highestCompleted", label: "Highest number of years/degree completed:", type: "text", maxLength: 80 },
      { name: "employmentStatus", label: "18. Employment Status: (✓ One)", type: "radio", required: true, options: ["Employed", "Employed but received notice of termination", "Not Employed"] },
      { name: "h_19", label: "19. Job Bank Resume:", type: "heading" },
      yn("jobBank", "Do you want your resume listed in America's Job Bank?", false),
      { name: "confidential", label: "Do you want your personal information to remain confidential? (If yes, you must have a valid E-mail address)", type: "radio", options: YES_NO },
      yn("migrant", "20. Are you a Migrant/Seasonal Worker?", false),
      { name: "migrantClass", label: "If yes, ✓ class:", type: "radio", options: ["Migrant Farm Worker", "Migrant Food Proc. Worker", "Seasonal Farm Worker"] },
      { name: "contactBy", label: "21. How do you want to be contacted? (✓ all that apply)", type: "multi", options: ["US Mail", "Primary Phone", "Alternate Phone", "Fax", "Email"] },
      { name: "h_22", label: "22. Employment Preferences: (✓ all that apply)", type: "heading" },
      { name: "desire", label: "Desire:", type: "multi", options: ["Full-time", "Part-time", "Permanent", "Temporary"] },
      { name: "shift", label: "Shift:", type: "multi", options: ["Any", "1st", "2nd", "3rd", "Split", "Rotating"] },
      { name: "minPay", label: "Minimum Desired Pay: $", type: "text", maxLength: 20 },
      { name: "minPayPer", label: "per", type: "text", maxLength: 20 },
      { name: "h_23", label: "23.", type: "heading" },
      { name: "militaryBranch", label: "Military Service: Branch:", type: "text", maxLength: 80 },
      { name: "campaignVeteran", label: "Campaign Veteran", type: "checkbox" },
      { name: "activeFrom", label: "Active Service from:", type: "date" },
      { name: "activeTo", label: "to", type: "date" },
      { name: "serviceDisability", label: "Service Disability:", type: "radio", options: ["Disabled", "Not Disabled", "Special"] },
      { name: "h_24", label: "24. Severance Pay (from most recent employment):", type: "heading" },
      { name: "severanceAmount", label: "Estimated Amount Received: $ (last 6 months)", type: "text", maxLength: 20 },
      { name: "severanceType", label: "Severance", type: "radio", options: ["Lump Sum pay", "Installment Pay", "No information at this time"] },
      { name: "lumpSumDate", label: "Lump Sum pay: Date Received:", type: "date" },
      { name: "installmentStart", label: "Installment Pay: Start Date:", type: "date" },
      { name: "jobObjective", label: "25. Job Objective:", type: "text", maxLength: 300 },
      yn("interestedTraining", "26. Are you interested in training:", false),
      { name: "travel", label: "27. How far are you willing to travel for work:", type: "radio", options: ["5 Miles", "10 Miles", "25 Miles", "50 Miles", "100 miles"] },
      { name: "h_28", label: "28. Work History (current/last employer):", type: "heading" },
      { name: "jobTitle", label: "Job Title:", type: "text", maxLength: 120 },
      { name: "employer", label: "Employer:", type: "text", maxLength: 160 },
      { name: "workStreet", label: "Street:", type: "text", maxLength: 160 },
      { name: "workCity", label: "City:", type: "text", maxLength: 80 },
      { name: "workState", label: "State:", type: "text", maxLength: 40 },
      { name: "workStart", label: "Start Date:", type: "date" },
      { name: "workEnd", label: "End Date:", type: "date" },
      { name: "wage", label: "Wage $", type: "text", maxLength: 20 },
      { name: "wagePer", label: "per", type: "text", maxLength: 20 },
      { name: "leaveReason", label: "Reason for Leaving:", type: "radio", options: ["Lack of Work/Lay Off", "Plant/Dept. Closure", "Other (Specify)"] },
      { name: "leaveOther", label: "Other (Specify)", type: "text", maxLength: 200 },
      { name: "jobDuties", label: "Job Duties:", type: "textarea", maxLength: 1000 },
      { name: "additionalSkills", label: "29. Additional Skills:", type: "textarea", maxLength: 1000 },
      { name: "license", label: "30. Driver's License:", type: "multi", options: ["None", "Car", "Motorcycle", "CDL-A", "CDL-B", "CDL-C"] },
      { name: "licenseState", label: "State:", type: "text", maxLength: 40 },
      { name: "n_31", label: "31. I certify that the above information is true and correct to the best of my knowledge", type: "note" },
    ],
    check: (d): Record<string, string> => (d.leaveReason === "Other (Specify)" && !String(d.leaveOther ?? "").trim() ? { leaveOther: "Please specify the reason" } : {}),
  },
  {
    key: "grievance_policy", title: "Grievance Policy and Procedures", version: 2, group: "COMMON", appliesTo: "ALL",
    containsFees: false, requiresSignature: true, pendingOfficialText: false,
    body: [
      "GRIEVANCE POLICY & PROCEDURES:",
      "1. In the event any student has a grievance related to the school, its employees, or fellow students, including all academic or personal issues, as well as any claims related to discrimination or including harassment.",
      "2. The student must submit a request in writing for an appointment for an interview with the School Director(s) which should include the following information:",
      "3. Student's full name, social security number, and current address.",
      "4. State the concern including dates, times, and instructors, staff, or other Students involved.",
      "5. Indicate three dates available for a meeting with the school Director and/or an appeal panel.",
      "6. Student's signature and date signed.",
      "7. Once the Director has received such a request, he/she will arrange an appointment within five (5) business days of the receipt of the written request and will notify the student and the accused of such.",
      "591 Summit Ave Suite 400 Jersey City, NJ 07306 · Phone: (201) 377-1594 Fax (973) 255-3900 · Website: http://www.brighthorizoninstitute.com",
    ],
    fields: [{ name: "studentName", label: "Name of the Student", type: "text", required: true, maxLength: 120, prefill: "name" }],
  },
  {
    key: "photo_release", title: "Photo Release Form", version: 2, group: "COMMON", appliesTo: "ALL",
    containsFees: false, requiresSignature: true, pendingOfficialText: false,
    body: (ctx) => [
      "Bright Horizon Institute · 910 Bergen Ave Floor 3 Jersey City, New Jersey 07306 · PH: 201-377-1594",
      `I, ${ctx.studentName}, hereby grant Bright Horizon Institute permission to use my likeness in any photographs, videos, or other media taken during my participation in the program. I understand that these materials may be used for educational, promotional, or marketing purposes, including but not limited to:`,
      "• Social media platforms (Facebook, Instagram, TikTok, etc.)\n• School website and brochures\n• Advertising and promotional materials\n• Educational content and presentations",
      "I understand that:",
      "• These images may be used without compensation to me.\n• My personal information (such as name) may be used in connection with these images unless I request otherwise.",
    ],
    fields: [
      { name: "studentName", label: "Student Name:", type: "text", required: true, maxLength: 120, prefill: "name" },
      { name: "photoRelease", label: "Photo release", type: "radio", required: true, options: ["I give permission", "I do not give permission"] },
    ],
  },

  // ----- Private Forms -----
  {
    key: "private_agreement_1", title: "Enrollment Agreement (page 1)", version: 2, group: "PRIVATE", appliesTo: ["PRIVATE"],
    containsFees: true, requiresSignature: false, pendingOfficialText: false,
    body: (ctx) => {
      const f = ctx.course?.fees ?? null;
      return [
        "591 Summit Avenue, Suite 400 · Jersey City, NJ 07306 · P: (201) 377-1594",
        "ENROLLMENT AGREEMENT",
        `I, ${ctx.studentName} (Name of Student) hereby seek enrollment for training leading to certification in ${ctx.course?.name ?? "________"} (Title of Program) at Bright Horizon Institute. I agree to comply with the school policy in its entirety and do understand that Tuition is my direct responsibility. It is the responsibility of the student to obtain approval from the sponsoring agency before starting the program otherwise the student will be held responsible for the payment.`,
        "I understand that the total amount for this program is application fee of $25.00 and a registration fee of $100.00 payable at the time of Enrollment. This is to cover the cost of:",
        `Tuition $${usd(f?.tuitionCents)}    Books $${usd(f?.booksCents)}    Supply $${usd(f?.toolsCents)}    uniforms $0    other $${usd((f?.feesCents ?? 0) + (f?.otherCents ?? 0))}`,
        "Start dates for all programs will be held on the first week of every month",
        "Requirements for Graduation",
        "In order to graduate the student must successfully complete all on-campus courses with a minimum grade average of 75% for each section, successfully complete the clinical externship, be current with all financial obligations to the school, complete all affiliated institutional exit interviews and maintain an overall attendance of 80%.",
        "Closures & Delay Notices",
        "Occasionally, BHI experiences some nasty weather that makes it unsafe for students to travel to and from school. In these situations, we may cancel school or run on a two-hour delay. If one of these situations occurs, our phone messenger system will provide updated information and we will notify the students through email and phone.",
        "In the event of an unannounced school closure, students enrolled at the time of the closure must contact the Department of Labor and Workforce Development's Training Evaluation Unit within ninety (90) calendar days of the closure. Failure to do so within ninety (90) days may exclude the student from any available form of assistance. The contact number to call is (609)-292-4287 or email at trainingevaluationunit@dol.nj.gov.",
      ];
    },
    fields: [{ name: "studentName", label: "Name of Student", type: "text", required: true, maxLength: 120, prefill: "name" }],
  },
  {
    key: "private_agreement_2", title: "Enrollment Agreement (page 2)", version: 2, group: "PRIVATE", appliesTo: ["PRIVATE"],
    containsFees: true, requiresSignature: true, pendingOfficialText: false,
    body: [
      "Employment Services",
      "The school provides employment assistance to all graduated Bright Horizon Students. Finding employment is a joint effort between school and student. The student must agree to cooperate with the job placement/career services coordinator to maximize success for helping to find employment in the allied health or related field. The school cannot and does not promise or guarantee placement upon graduation. Employment is only attained by the applicant that truly seeks it.",
      "The student agrees to comply with school rules and regulations during his/her program of study, and the school has the right to terminate the student's enrollment in the event of the student's failure to comply with the rules and regulations. A student's enrollment may also be terminated for failure to maintain a satisfactory grade point average, failure to meet school attendance requirements and/or failure to be current in all financial obligations to the school.",
      "By signing below, I the undersigned purchase the above program of training acknowledge having received, read and understood a copy of this Enrollment Agreement and the School Catalog and agree to comply with the terms of each. I further acknowledge that no oral representations regarding the percentage of graduates, employed or starting salaries have been made to me by any representative or employee of the school. This enrollment agreement may be cancelled within two days of signing. Any questions regarding terms of this Enrollment Agreement should be addressed to the appropriate school representative.",
    ],
    fields: [{ name: "n_sign", label: SIGN_DATE_NOTE, type: "note" }],
  },
  {
    key: "refund_schedule", title: "Tuition Refund Schedule", version: 2, group: "PRIVATE", appliesTo: ["PRIVATE"],
    containsFees: true, requiresSignature: true, pendingOfficialText: false,
    body: [
      "Refund Policy",
      "A full refund will be made to any student, or any local, state, federal agency that paid tuition on behalf of the student. No refunds will be made to the student for Registration fees, books, equipment, or tools purchased from the school and issued to the student.",
      "If withdrawal or cancellation occurs: — The school will retain:\nDuring the first week — 10% of the tuition\nDuring the second or third week — 20% of the tuition\nAfter the third week but prior to completion of 25 percent of the course. — 45% of the tuition\nAfter 25 percent but not more than 50 percent Of the course has been attended. — 70 % of the tuition\nAfter completion of more than 50 % of the course. — 100% of the tuition",
      "For part time attendance in courses over 300 hours in length calculation of the amount the school may retain in addition to the application and registration fee plus:",
      "If withdrawal or cancellation occurs: — The school will retain:\nDuring the first 25 hours of scheduled attendance — 10% of the tuition\nDuring hours 26 through 75 of scheduled attendance — 20% of the tuition\nAfter the third week but prior to the completion of 25% of the course — 45% of the tuition\nAfter 25% but not more than 50 percent of the course — 70% of the tuition\nAfter completion of more than 50% of the course — 100% of the tuition",
    ],
    fields: [{ name: "n_sign", label: "Applicant Signature and Date: " + SIGN_DATE_NOTE, type: "note" }],
  },

  // ----- Non-Private Forms -----
  {
    key: "nonprivate_agreement", title: "Non-Private Enrollment Agreement", version: 1, group: "NON_PRIVATE", appliesTo: ["EQISS", "DFS"],
    containsFees: false, requiresSignature: true, pendingOfficialText: true,
    fields: [{ name: "acknowledged", label: "I have read the Non-Private Enrollment Agreement and agree to its terms.", type: "checkbox", required: true }],
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

/** Zod schema built from a template's fields (plus its cross-field rules). Unknown keys are stripped. */
export function schemaFor(t: FormTemplate) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const f of t.fields) {
    if (!isInput(f)) continue;
    if (f.type === "checkbox") {
      shape[f.name] = f.required
        ? z.boolean().refine((v) => v === true, "Please confirm to continue")
        : z.boolean().default(false);
      continue;
    }
    if (f.type === "multi") {
      const opts = f.options ?? [];
      shape[f.name] = z
        .array(z.string())
        .default([])
        .superRefine((v, ctx) => {
          if (v.some((x) => !opts.includes(x))) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Choose from the options" });
          if (f.required && v.length === 0) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Choose at least one" });
        });
      continue;
    }
    const max = f.type === "ssn" ? 11 : f.maxLength ?? 500;
    let field: z.ZodTypeAny = z
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
        if ((f.type === "select" || f.type === "radio") && f.options && !f.options.includes(v))
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Choose one of the options" });
        if (f.type === "ssn" && !/^\d{3}-?\d{2}-?\d{4}$/.test(v))
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter 9 digits, e.g. 123-45-6789" });
      });
    // Store Social Security numbers in one format (123-45-6789).
    if (f.type === "ssn") field = field.transform((v: string) => (v ? v.replace(/\D/g, "").replace(/^(\d{3})(\d{2})(\d{4})$/, "$1-$2-$3") : v));
    shape[f.name] = field;
  }
  const obj = z.object(shape).strip();
  if (!t.check) return obj;
  const check = t.check;
  return obj.superRefine((data, ctx) => {
    for (const [path, message] of Object.entries(check(data as Record<string, unknown>))) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
  });
}

/** Raw answers from a submitted form (lists for "check all that apply"). */
export function rawFromForm(t: FormTemplate, fd: FormData): Record<string, FormDataEntryValue | FormDataEntryValue[] | undefined> {
  return Object.fromEntries(inputFields(t).map((f) => [f.name, f.type === "multi" ? fd.getAll(f.name) : fd.get(f.name) ?? undefined]));
}

/** Parses FormData-like raw input into typed answers. */
export function coerceRaw(t: FormTemplate, raw: Record<string, FormDataEntryValue | FormDataEntryValue[] | undefined>) {
  const out: Record<string, unknown> = {};
  for (const f of inputFields(t)) {
    const v = raw[f.name];
    if (f.type === "checkbox") out[f.name] = v === "on" || v === "true";
    else if (f.type === "multi") out[f.name] = (Array.isArray(v) ? v : v === undefined ? [] : [v]).filter((x): x is string => typeof x === "string");
    else out[f.name] = typeof v === "string" ? v : "";
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
  if (key === "review") return "Review and submit";
  return TEMPLATES.find((t) => t.key === key)?.title ?? key;
}
