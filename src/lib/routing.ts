import type { ApplicationStatus } from "@/db/types";

export type RoutingInput = {
  role: "STUDENT" | "INSTRUCTOR" | "ADMIN";
  emailVerified: boolean;
  instructorStatus?: "PENDING" | "APPROVED" | "REJECTED" | null;
  applicationStatus?: ApplicationStatus | null;
  hasActiveEnrollment?: boolean;
};

export type StudentStage = "ENROLL" | "STATUS" | "DASHBOARD";

/** The one screen a student may use, based purely on status. Single source of truth for gating. */
export function studentStage(status: ApplicationStatus | null | undefined, hasActiveEnrollment: boolean): StudentStage {
  switch (status ?? "DRAFT") {
    case "DRAFT":
    case "CORRECTIONS_REQUESTED":
      return "ENROLL";
    case "APPROVED":
      return hasActiveEnrollment ? "DASHBOARD" : "STATUS";
    default:
      return "STATUS";
  }
}

const stagePath: Record<StudentStage, string> = { ENROLL: "/enroll", STATUS: "/application", DASHBOARD: "/dashboard" };

export function homeFor(u: RoutingInput): string {
  if (!u.emailVerified) return "/verify";
  if (u.role === "ADMIN") return "/admin";
  if (u.role === "INSTRUCTOR") return u.instructorStatus === "APPROVED" ? "/instructor" : "/instructor/pending";
  return stagePath[studentStage(u.applicationStatus, !!u.hasActiveEnrollment)];
}
