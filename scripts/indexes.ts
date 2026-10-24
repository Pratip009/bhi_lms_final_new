import type { Db } from "mongodb";
import { canonicalEmail } from "../src/lib/email-canonical";

/** Creates every index the app relies on. Safe to run repeatedly. */
/**
 * Fills users.emailCanonical for accounts created before it existed. If two existing accounts share
 * a Gmail mailbox, only the oldest gets the value (so the unique index can be built) and the others
 * are reported for an admin to merge or disable by hand.
 */
export async function backfillCanonicalEmails(db: Db) {
  const users = db.collection<{ _id: string; email: string; emailCanonical?: string; createdAt: Date }>("users");
  const taken = new Set((await users.find({ emailCanonical: { $exists: true } }, { projection: { emailCanonical: 1 } }).toArray()).map((u) => u.emailCanonical!));
  const todo = await users.find({ emailCanonical: { $exists: false } }).sort({ createdAt: 1 }).toArray();
  const clashes: string[] = [];
  for (const u of todo) {
    const c = canonicalEmail(u.email);
    if (taken.has(c)) { clashes.push(`${u.email} (same mailbox as an existing account: ${c})`); continue; }
    await users.updateOne({ _id: u._id, emailCanonical: { $exists: false } }, { $set: { emailCanonical: c } });
    taken.add(c);
  }
  if (todo.length) console.log(`Normalised email set on ${todo.length - clashes.length} existing account(s).`);
  for (const c of clashes) console.warn(`! Duplicate mailbox, review by hand: ${c}`);
}

export async function ensureIndexes(db: Db) {
  await backfillCanonicalEmails(db);
  const idx = async (col: string, spec: Record<string, 1 | -1>, opts: Record<string, unknown> = {}) => {
    await db.collection(col).createIndex(spec, opts);
  };
  await idx("users", { email: 1 }, { unique: true, name: "users_email_uq" });
  try {
    await idx("users", { emailCanonical: 1 }, { unique: true, name: "users_email_canonical_uq", partialFilterExpression: { emailCanonical: { $exists: true } } });
  } catch (e) {
    // MongoDB and Atlas support partial indexes; some MongoDB-compatible test servers don't (code 238).
    // The app still checks for duplicates before inserting; only the race-proof backstop is missing.
    if ((e as { code?: number }).code !== 238) throw e;
    console.warn("Partial index on users.emailCanonical not supported by this server; skipped.");
  }
  await idx("users", { role: 1, instructorStatus: 1 });
  await idx("sessions", { userId: 1 });
  await idx("otp_codes", { userId: 1, purpose: 1, createdAt: -1 });
  await idx("applications", { studentId: 1 }, { unique: true, name: "applications_student_uq" });
  await idx("applications", { status: 1, updatedAt: -1 });
  await idx("applications", { "documents._id": 1 });
  await idx("classes", { code: 1 }, { unique: true, name: "classes_code_uq" });
  await idx("classes", { courseId: 1 });
  await idx("classes", { "instructors.instructorId": 1 });
  await idx("enrollments", { studentId: 1, classId: 1 }, { unique: true, name: "enrollments_student_class_uq" });
  await idx("enrollments", { classId: 1, status: 1 });
  await idx("class_sessions", { classId: 1, date: 1 }, { unique: true, name: "class_sessions_class_date_uq" });
  await idx("attendance_checkins", { classId: 1, date: 1 }, { unique: true, name: "attendance_checkins_class_date_uq" });
  await idx("progress_reports", { enrollmentId: 1, month: 1 }, { unique: true, name: "progress_reports_enrollment_month_uq" });
  await idx("progress_reports", { month: 1 });
  await idx("audit_logs", { entity: 1, entityId: 1, createdAt: -1 });
  // October 2026 requirements
  await idx("applications", { category: 1, county: 1, courseId: 1 });
  await idx("applications", { category: 1, paymentStatus: 1 });
  await idx("enrollments", { studentId: 1, status: 1 });
  await idx("course_assignments", { instructorId: 1, removedAt: 1 });
  await idx("course_assignments", { courseId: 1, removedAt: 1 });
  await idx("attendance_signoffs", { enrollmentId: 1, month: 1 }, { unique: true, name: "attendance_signoffs_enrollment_month_uq" });
  await idx("biweekly_timesheets", { enrollmentId: 1, periodStart: 1 }, { unique: true, name: "biweekly_enrollment_period_uq" });
  await idx("biweekly_timesheets", { studentId: 1, courseId: 1, periodStart: 1 });

  // TTL clean-up (MongoDB). Not essential for correctness: expired rows are ignored by the app anyway.
  for (const [col, field] of [["sessions", "expiresAt"], ["otp_codes", "expiresAt"], ["rate_limits", "expiresAt"]] as const) {
    try {
      await idx(col, { [field]: 1 }, { expireAfterSeconds: 0, name: `${col}_ttl` });
    } catch (e) {
      console.warn(`TTL index on ${col} skipped: ${(e as Error).message}`);
    }
  }
}
