import Link from "next/link";
import { requireInstructor } from "@/lib/auth";
import { SheetView, loadEnrollmentFor } from "@/components/sheet-view";

export const dynamic = "force-dynamic";

export default async function InstructorSheetPage({ params, searchParams }: { params: Promise<{ enrollmentId: string }>; searchParams: Promise<{ month?: string; period?: string }> }) {
  const user = await requireInstructor();
  const { enrollmentId } = await params;
  const enrollment = await loadEnrollmentFor(user, enrollmentId);
  return (
    <SheetView user={user} enrollment={enrollment} sp={await searchParams} basePath={`/instructor/attendance/${enrollmentId}`}
      back={<Link href={`/instructor/classes/${enrollment.classId}`} className="text-sm text-pine-700 underline">Back to the class</Link>} />
  );
}
