import { cols } from "@/db";
import { requireAdmin } from "@/lib/auth";
import { StaffShell } from "@/components/staff-shell";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin();
  const { applications, users } = await cols();
  const [pending, pendingInstructors] = await Promise.all([
    applications.countDocuments({ status: { $in: ["SUBMITTED", "RESUBMITTED"] } }),
    users.countDocuments({ role: "INSTRUCTOR", instructorStatus: "PENDING" }),
  ]);
  // Kept short for non-technical staff: attendance, live check-in and monthly reports share one item.
  const nav = [
    { href: "/admin", label: "Home" },
    { href: "/admin/applications", label: "Applications", badge: pending },
    { href: "/admin/students", label: "Students" },
    { href: "/admin/courses", label: "Courses and classes" },
    { href: "/admin/instructors", label: "Instructors", badge: pendingInstructors },
    { href: "/admin/attendance", label: "Attendance and reports" },
    { href: "/admin/guide", label: "Help" },
  ];
  return <StaffShell name={admin.name} role="Admin" nav={nav}>{children}</StaffShell>;
}
