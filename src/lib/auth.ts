import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { cols, type User, type Application } from "@/db";
import { getSessionUser } from "@/lib/session";
import { homeFor, studentStage, type StudentStage } from "@/lib/routing";

export const currentUser = cache(getSessionUser);

export async function requireUser(): Promise<User> {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!user.emailVerifiedAt) redirect("/verify");
  return user;
}

export async function requireAdmin(): Promise<User> {
  const user = await requireUser();
  if (user.role !== "ADMIN") redirect(await homePath(user));
  return user;
}

export async function requireInstructor(): Promise<User> {
  const user = await requireUser();
  if (user.role !== "INSTRUCTOR") redirect(await homePath(user));
  if (user.instructorStatus !== "APPROVED") redirect("/instructor/pending");
  return user;
}

export async function getStudentContext(userId: string) {
  const { applications, enrollments } = await cols();
  const [application, active] = await Promise.all([
    applications.findOne({ studentId: userId }),
    enrollments.findOne({ studentId: userId, status: "ACTIVE" }, { projection: { _id: 1 } }),
  ]);
  return { application, hasActiveEnrollment: !!active };
}

/** Allows the page only when the student's current stage matches; otherwise sends them where they belong. */
export async function requireStudentStage(stage: StudentStage): Promise<{ user: User; application: Application }> {
  const user = await requireUser();
  if (user.role !== "STUDENT") redirect(await homePath(user));
  const ctx = await getStudentContext(user._id);
  if (!ctx.application) throw new Error("Student has no application record");
  const actual = studentStage(ctx.application.status, ctx.hasActiveEnrollment);
  if (actual !== stage) {
    redirect(homeFor({ role: "STUDENT", emailVerified: true, applicationStatus: ctx.application.status, hasActiveEnrollment: ctx.hasActiveEnrollment }));
  }
  return { user, application: ctx.application };
}

export async function homePath(user: User): Promise<string> {
  if (user.role !== "STUDENT") {
    return homeFor({ role: user.role, emailVerified: !!user.emailVerifiedAt, instructorStatus: user.instructorStatus });
  }
  const ctx = await getStudentContext(user._id);
  return homeFor({ role: "STUDENT", emailVerified: !!user.emailVerifiedAt, applicationStatus: ctx.application?.status, hasActiveEnrollment: ctx.hasActiveEnrollment });
}
