import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStudentStage } from "@/lib/auth";
import { StudentShell } from "@/components/student-shell";
import { SheetView, loadEnrollmentFor } from "@/components/sheet-view";

export const dynamic = "force-dynamic";

/** A student's own attendance sheet (any of their enrollments, including earlier sections). */
export default async function StudentSheetPage({ params, searchParams }: { params: Promise<{ enrollmentId: string }>; searchParams: Promise<{ month?: string; period?: string }> }) {
  const { user } = await requireStudentStage("DASHBOARD");
  const { enrollmentId } = await params;
  const enrollment = await loadEnrollmentFor(user, enrollmentId);
  if (enrollment.studentId !== user._id) notFound(); // belt and braces: loadEnrollmentFor already enforces it
  return (
    <StudentShell name={user.name} step={4}>
      <SheetView user={user} enrollment={enrollment} sp={await searchParams} basePath={`/dashboard/attendance/${enrollmentId}`}
        back={<Link href="/dashboard" className="text-sm text-pine-700 underline">My dashboard</Link>} />
    </StudentShell>
  );
}
