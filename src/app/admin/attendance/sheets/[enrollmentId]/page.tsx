import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { SheetView, loadEnrollmentFor } from "@/components/sheet-view";

export const dynamic = "force-dynamic";

export default async function AdminSheetPage({ params, searchParams }: { params: Promise<{ enrollmentId: string }>; searchParams: Promise<{ month?: string; period?: string }> }) {
  const user = await requireAdmin();
  const { enrollmentId } = await params;
  const enrollment = await loadEnrollmentFor(user, enrollmentId);
  return (
    <SheetView user={user} enrollment={enrollment} sp={await searchParams} basePath={`/admin/attendance/sheets/${enrollmentId}`}
      back={<Link href={`/admin/students/${enrollment.studentId}`} className="text-sm text-pine-700 underline">Student record</Link>} />
  );
}
