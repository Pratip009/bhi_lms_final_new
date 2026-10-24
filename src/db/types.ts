export type Role = "STUDENT" | "INSTRUCTOR" | "ADMIN";
export type InstructorStatus = "PENDING" | "APPROVED" | "REJECTED";
export type OtpPurpose = "VERIFY_EMAIL" | "RESET_PASSWORD";
/**
 * Funding track. Derived from the student's choices and used to pick forms and the attendance sheet:
 * PRIVATE (self-paying), EQISS (Non-Private, EQISS / One-Stop) or DFS (Non-Private, Department of Family Services).
 * Enrollment type, funding program and county are stored separately on the application as well.
 */
export type Category = "PRIVATE" | "EQISS" | "DFS";
export type EnrollmentType = "PRIVATE" | "NON_PRIVATE";
export type NonPrivateProgram = "EQISS" | "DFS";
export type County = "HUDSON" | "BERGEN" | "SOMERSET";
export type ApplicationStatus = "DRAFT" | "SUBMITTED" | "CORRECTIONS_REQUESTED" | "RESUBMITTED" | "APPROVED" | "REJECTED";
export type PaymentStatus = "NOT_REQUIRED" | "PENDING" | "PAID" | "WAIVED";
export type EnrollmentStatus = "ACTIVE" | "COMPLETED" | "WITHDRAWN" | "TRANSFERRED";
export type AttendanceStatus = "PRESENT" | "ABSENT" | "LATE" | "EXCUSED" | "HOLIDAY";
export type ReportStatus = "DRAFT" | "SUBMITTED";
export type FundingProgram = Category | "MIXED";

/** All ids are UUID strings (crypto.randomUUID), stored in _id. */
export type User = {
  _id: string;
  name: string;
  email: string;
  /** Gmail-normalised email, unique (see lib/email-canonical). Absent on accounts created before it existed. */
  emailCanonical?: string;
  inviteTokenHash?: string | null;
  inviteExpiresAt?: Date | null;
  passwordHash: string;
  role: Role;
  instructorStatus: InstructorStatus | null;
  emailVerifiedAt: Date | null;
  disabledAt: Date | null;
  passwordChangedAt: Date;
  createdAt: Date;
};

export type Session = { _id: string; userId: string; expiresAt: Date; revokedAt: Date | null; ip: string; userAgent: string; createdAt: Date };

export type OtpCode = {
  _id: string;
  userId: string;
  purpose: OtpPurpose;
  codeHash: string;
  attempts: number;
  expiresAt: Date;
  consumedAt: Date | null;
  createdAt: Date;
};

/** Fixed-window counter; _id = `${key}:${windowNumber}`. */
export type RateLimit = { _id: string; count: number; expiresAt: Date };

export type FormResponse = {
  templateVersion: number;
  data: Record<string, unknown>;
  completedAt: Date | null;
  updatedAt: Date;
  /** Set when an admin changed the answers; the before/after values are in audit_logs. */
  adminEditedAt?: Date | null;
  adminEditedById?: string | null;
};
export type Signature = { imageDataUrl: string; signerName: string; dataHash: string; ip: string; userAgent: string; signedAt: Date };
export type AppDocument = { _id: string; type: string; storageKey: string; fileName: string; mimeType: string; size: number; createdAt: Date };
export type Correction = { _id: string; sections: string[]; note: string; requestedById: string; createdAt: Date; resolvedAt: Date | null };

/**
 * One document per student. Answers, signatures, uploads and correction requests are embedded,
 * so every change to an application is a single atomic update (no multi-document transactions).
 */
export type SubmissionSnapshot = {
  submittedAt: Date;
  kind: "SUBMIT" | "RESUBMIT";
  category: Category | null;
  county: County | null;
  courseId: string | null;
  forms: Record<string, FormResponse>;
  documentIds: string[];
};

export type Application = {
  _id: string;
  studentId: string;
  /** Derived funding track (see Category). Kept in step with enrollmentType / fundingProgram. */
  category: Category | null;
  enrollmentType?: EnrollmentType | null;
  fundingProgram?: NonPrivateProgram | null;
  county?: County | null;
  /** Course chosen by the student during enrollment. */
  courseId?: string | null;
  status: ApplicationStatus;
  paymentStatus: PaymentStatus;
  /** Private only: what the student reported paying (receipt / confirmation number). Verified by an admin. */
  paymentReference?: string | null;
  paymentReportedAt?: Date | null;
  paymentVerifiedAt?: Date | null;
  paymentVerifiedById?: string | null;
  /** Copies of what was sent for review each time, so resubmissions never erase earlier versions. */
  submissions?: SubmissionSnapshot[];
  forms: Record<string, FormResponse>; // keyed by template key
  signatures: Record<string, Signature>; // keyed by template key
  documents: AppDocument[];
  corrections: Correction[]; // newest last; the open one has resolvedAt = null
  submittedAt: Date | null;
  decidedAt: Date | null;
  decidedById: string | null;
  rejectionReason: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type Course = { _id: string; name: string; description: string; fundingPrograms: Category[]; archived: boolean; createdAt: Date };

export type ClassInstructor = { instructorId: string; role: "LEAD" | "ASSISTANT"; assignedAt: Date };
export type Klass = {
  _id: string;
  courseId: string;
  code: string;
  cohort: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;
  schedule: string;
  location: string;
  capacity: number;
  fundingProgram: FundingProgram;
  archived: boolean;
  instructors: ClassInstructor[];
  /** Set when this section was merged into another; its roster moved there and its records stay here. */
  mergedIntoClassId?: string | null;
  mergedAt?: Date | null;
  /** Created automatically on approval when a course had no open section. */
  isDefaultSection?: boolean;
  createdAt: Date;
};

/** Instructor-to-course assignment. Removal sets removedAt instead of deleting, so history stays. */
export type CourseAssignment = {
  _id: string;
  instructorId: string;
  courseId: string;
  assignedById: string;
  assignedAt: Date;
  removedAt: Date | null;
  removedById: string | null;
};

export type Enrollment = {
  _id: string;
  studentId: string;
  classId: string;
  status: EnrollmentStatus;
  assignedById: string;
  assignedAt: Date;
  endedAt: Date | null;
  /** Course at the time of enrollment (denormalised so history survives class edits). */
  courseId?: string;
  /** Section moves and merges: the old enrollment is ended (TRANSFERRED) and linked to the new one. */
  movedToEnrollmentId?: string | null;
  movedFromEnrollmentId?: string | null;
  endReason?: string | null;
};

export type HandSignature = { imageDataUrl: string; signedAt: Date; capturedById?: string | null };
/**
 * One student's mark for a class day. The handwritten fields (times and signature) come from the
 * handwritten attendance app or are entered on the monthly sheet; older records only have status/hours/note.
 */
export type AttendanceRecord = {
  status: AttendanceStatus;
  hours: number;
  note: string;
  recordedById: string;
  updatedAt: Date;
  startTime?: string; // HH:MM, 24h
  lunchOut?: string;
  lunchIn?: string;
  endTime?: string;
  studentSignature?: HandSignature | null;
};
/** One document per class per date; records keyed by enrollment id. */
export type ClassSession = { _id: string; classId: string; date: string; records: Record<string, AttendanceRecord>; createdAt: Date };

/** One student's self check-in for a class day. */
export type CheckInEntry = { at: Date; status: "PRESENT" | "LATE"; deviceId: string; ip: string };
/**
 * Live student check-in for one class on one date (unique per class + date). The instructor opens it,
 * students enter the rotating code, and the instructor then confirms attendance on the normal sheet.
 * Check-ins never become attendance records by themselves: the instructor's saved sheet is the record.
 */
export type CheckInSession = {
  _id: string;
  classId: string;
  date: string; // YYYY-MM-DD, office time zone
  openedAt: Date; // first opening of the day; lateness is measured from here
  openedById: string;
  lateAfterMinutes: number;
  expiresAt: Date; // check-in stops on its own at this time even if nobody closes it
  closedAt: Date | null;
  closedById: string | null;
  seed: string; // random per opening; the rotating codes are derived from it
  entries: Record<string, CheckInEntry>; // keyed by enrollment id
  createdAt: Date;
};

export type StaffSignature = { imageDataUrl: string; signerName: string; signedAt: Date; signerId: string };

export type ReportRevision = {
  data: Record<string, unknown>;
  status: ReportStatus;
  signature: StaffSignature | null;
  authorId: string;
  instructorName?: string;
  savedAt: Date;
};

export type ProgressReport = {
  _id: string;
  enrollmentId: string;
  month: string; // YYYY-MM
  templateVersion: number;
  data: Record<string, unknown>;
  status: ReportStatus;
  authorId: string;
  /** Instructor name as it appeared on the report when saved (kept even if assignments change). */
  instructorName?: string;
  signature?: StaffSignature | null;
  /** Earlier versions, newest last. */
  revisions?: ReportRevision[];
  submittedAt: Date | null;
  updatedAt: Date;
};

/** Instructor sign-off of a DFS / Private monthly handwritten attendance sheet (one per enrollment and month). */
export type AttendanceSignoff = {
  _id: string;
  enrollmentId: string;
  month: string; // YYYY-MM
  signature: StaffSignature;
  /** Hash of the month's entries at signing; a mismatch later means entries changed after sign-off. */
  entriesHash: string;
  history: { signature: StaffSignature; entriesHash: string; replacedAt: Date }[];
};

export type BiweeklyCode = "" | "A" | "H" | "S";
export type BiweeklyDay = {
  date: string; // YYYY-MM-DD
  timeIn: string;
  timeOut: string;
  code: BiweeklyCode;
  customerInitials: string;
  instructorInitials: string;
  hours: number;
};
export type BiweeklyHeader = {
  ssnLast4: string;
  contractNumber: string;
  caseManager: string;
  schoolName: string;
  trainingLocation: string;
  trainingName: string;
  programStart: string;
  programEnd: string;
  totalProgramHours: number;
  scheduledHours: number;
};
export type BiweeklyStatus = "OPEN" | "CUSTOMER_SIGNED" | "COMPLETED";
/**
 * EQISS / One-Stop "Customer Instructional Time, Attendance & Progress Biweekly Report — ITA Contract".
 * Same document for Hudson, Bergen and Somerset counties. One per enrollment and two-week period.
 */
export type BiweeklyTimesheet = {
  _id: string;
  enrollmentId: string;
  studentId: string;
  classId: string;
  courseId: string;
  county: County | null;
  periodStart: string; // Monday
  periodEnd: string; // Sunday, 13 days later
  header: BiweeklyHeader;
  days: BiweeklyDay[]; // exactly 14
  comments: string;
  progress: { courseGrades: string; indicator: "" | "ABOVE_AVERAGE" | "BELOW_AVERAGE"; additionalComments: string };
  customerSignature: (StaffSignature & { dataHash: string }) | null;
  instructorSignature: (StaffSignature & { dataHash: string }) | null;
  status: BiweeklyStatus;
  history: { at: Date; byId: string; action: string }[];
  createdAt: Date;
  updatedAt: Date;
};

export type AuditLog = { _id: string; actorId: string | null; action: string; entity: string; entityId: string | null; meta: Record<string, unknown>; createdAt: Date };
