import "server-only";
import { cols, type User } from "@/db";

export class ForbiddenError extends Error {
  constructor() {
    super("You don't have access to this record.");
  }
}

/** Courses an instructor is currently assigned to (active assignments only). */
export async function activeCourseIds(instructorId: string): Promise<string[]> {
  const { courseAssignments } = await cols();
  return courseAssignments.distinct("courseId", { instructorId, removedAt: null });
}

/**
 * Classes (sections) an instructor may work with now: every section of a course assigned to them,
 * plus sections they were put on directly. Removing an assignment removes access but never touches
 * the records they already wrote.
 */
export async function instructorClassFilter(instructorId: string) {
  const courseIds = await activeCourseIds(instructorId);
  return { $or: [{ "instructors.instructorId": instructorId }, { courseId: { $in: courseIds } }] };
}

export async function instructorTeachesClass(instructorId: string, classId: string) {
  const { classes } = await cols();
  return (await classes.countDocuments({ _id: classId, ...(await instructorClassFilter(instructorId)) }, { limit: 1 })) > 0;
}

/** Admin: any class. Instructor: only classes of their courses (or assigned directly). Students never manage classes. */
export async function assertCanManageClass(user: User, classId: string) {
  if (user.role === "ADMIN") return;
  if (user.role === "INSTRUCTOR" && user.instructorStatus === "APPROVED" && !user.disabledAt && (await instructorTeachesClass(user._id, classId))) return;
  throw new ForbiddenError();
}

/** Returns the enrollment if the user may see it (admin, an instructor of its class, or the student themself). */
export async function getVisibleEnrollment(user: User, enrollmentId: string) {
  const { enrollments } = await cols();
  const e = await enrollments.findOne({ _id: enrollmentId });
  if (!e) throw new ForbiddenError();
  if (user.role === "ADMIN") return e;
  if (user.role === "STUDENT" && e.studentId === user._id) return e;
  if (user.role === "INSTRUCTOR" && user.instructorStatus === "APPROVED" && !user.disabledAt && (await instructorTeachesClass(user._id, e.classId))) return e;
  throw new ForbiddenError();
}

export async function assertCanViewApplication(user: User, applicationId: string) {
  const { applications } = await cols();
  const a = await applications.findOne({ _id: applicationId });
  if (!a) throw new ForbiddenError();
  if (user.role === "ADMIN") return a;
  if (user.role === "STUDENT" && a.studentId === user._id) return a;
  throw new ForbiddenError();
}
