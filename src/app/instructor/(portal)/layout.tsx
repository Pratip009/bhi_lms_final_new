import { requireInstructor } from "@/lib/auth";
import { StaffShell } from "@/components/staff-shell";

export const dynamic = "force-dynamic";

export default async function InstructorLayout({ children }: { children: React.ReactNode }) {
  const user = await requireInstructor();
  return <StaffShell name={user.name} role="Instructor" nav={[{ href: "/instructor", label: "My courses" }]}>{children}</StaffShell>;
}
