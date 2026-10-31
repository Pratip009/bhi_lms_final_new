import type { ApplicationStatus } from "@/db/types";

export type RoutingInput = {
  role: "STUDENT" | "INSTRUCTOR" | "ADMIN";
  emailVerified: boolean;
  instructorStatus?: "PENDING" | "APPROVED" | "REJECTED" | null;
  applicationStatus?: ApplicationStatus | null;
  hasActiveEnrollment?: boolean;
  /** Has had a class before (completed, withdrawn or moved). Keeps the dashboard open for their earlier records. */
  hasEarlierEnrollment?: boolean;
};

export type StudentStage = "ENROLL" | "STATUS" | "DASHBOARD";

/** The one screen a student may use, based purely on status. Single source of truth for gating. */
export function studentStage(status: ApplicationStatus | null | undefined, hasActiveEnrollment: boolean, hasEarlierEnrollment = false): StudentStage {
  switch (status ?? "DRAFT") {
    case "DRAFT":
    case "CORRECTIONS_REQUESTED":
      return "ENROLL";
    case "APPROVED":
      // A student whose classes have all ended keeps their dashboard, so earlier attendance stays reachable.
      return hasActiveEnrollment || hasEarlierEnrollment ? "DASHBOARD" : "STATUS";
    default:
      return "STATUS";
  }
}

const stagePath: Record<StudentStage, string> = { ENROLL: "/enroll", STATUS: "/application", DASHBOARD: "/dashboard" };

export function homeFor(u: RoutingInput): string {
  if (!u.emailVerified) return "/verify";
  if (u.role === "ADMIN") return "/admin";
  if (u.role === "INSTRUCTOR") return u.instructorStatus === "APPROVED" ? "/instructor" : "/instructor/pending";
  return stagePath[studentStage(u.applicationStatus, !!u.hasActiveEnrollment, !!u.hasEarlierEnrollment)];
}
