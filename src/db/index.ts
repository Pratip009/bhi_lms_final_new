import "server-only";
import { randomUUID } from "node:crypto";
import { MongoClient, type Collection, type Db } from "mongodb";
import type {
  User, Session, OtpCode, RateLimit, Application, Course, Klass, Enrollment, ClassSession, CheckInSession, ProgressReport, AuditLog,
  CourseAssignment, AttendanceSignoff, BiweeklyTimesheet,
} from "./types";

export * from "./types";

const g = globalThis as unknown as { mongoClient?: Promise<MongoClient> };

function client(): Promise<MongoClient> {
  if (!g.mongoClient) {
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error("MONGODB_URI is not set");
    g.mongoClient = MongoClient.connect(uri, { maxPoolSize: 10, serverSelectionTimeoutMS: 10_000 }).catch((e) => {
      g.mongoClient = undefined; // retry on the next request instead of caching a failed connection
      throw e;
    });
  }
  return g.mongoClient;
}

export async function database(): Promise<Db> {
  return (await client()).db(process.env.MONGODB_DB || undefined);
}

export type Collections = {
  users: Collection<User>;
  sessions: Collection<Session>;
  otpCodes: Collection<OtpCode>;
  rateLimits: Collection<RateLimit>;
  applications: Collection<Application>;
  courses: Collection<Course>;
  classes: Collection<Klass>;
  enrollments: Collection<Enrollment>;
  classSessions: Collection<ClassSession>;
  checkIns: Collection<CheckInSession>;
  progressReports: Collection<ProgressReport>;
  auditLogs: Collection<AuditLog>;
  courseAssignments: Collection<CourseAssignment>;
  attendanceSignoffs: Collection<AttendanceSignoff>;
  biweeklySheets: Collection<BiweeklyTimesheet>;
};

export async function cols(): Promise<Collections> {
  const db = await database();
  return {
    users: db.collection<User>("users"),
    sessions: db.collection<Session>("sessions"),
    otpCodes: db.collection<OtpCode>("otp_codes"),
    rateLimits: db.collection<RateLimit>("rate_limits"),
    applications: db.collection<Application>("applications"),
    courses: db.collection<Course>("courses"),
    classes: db.collection<Klass>("classes"),
    enrollments: db.collection<Enrollment>("enrollments"),
    classSessions: db.collection<ClassSession>("class_sessions"),
    checkIns: db.collection<CheckInSession>("attendance_checkins"),
    progressReports: db.collection<ProgressReport>("progress_reports"),
    auditLogs: db.collection<AuditLog>("audit_logs"),
    courseAssignments: db.collection<CourseAssignment>("course_assignments"),
    attendanceSignoffs: db.collection<AttendanceSignoff>("attendance_signoffs"),
    biweeklySheets: db.collection<BiweeklyTimesheet>("biweekly_timesheets"),
  };
}

export const newId = () => randomUUID();

/** True for MongoDB duplicate-key errors (unique index violations). */
export const isDuplicateKey = (e: unknown) => !!e && typeof e === "object" && (e as { code?: number }).code === 11000;

export function newApplication(studentId: string): Application {
  const now = new Date();
  return {
    _id: newId(), studentId, category: null, enrollmentType: null, fundingProgram: null, county: null, courseId: null,
    status: "DRAFT", paymentStatus: "NOT_REQUIRED", submissions: [],
    forms: {}, signatures: {}, documents: [], corrections: [],
    submittedAt: null, decidedAt: null, decidedById: null, rejectionReason: null, createdAt: now, updatedAt: now,
  };
}
