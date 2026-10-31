import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { getClassWithCourse } from "@/lib/queries";
import { PageHeader } from "@/components/ui";
import { DayAttendance } from "@/components/day-attendance";

export const dynamic = "force-dynamic";

/** Admin: the same daily attendance screen instructors use, for any class and any date. */
export default async function AdminDayAttendance({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ date?: string }> }) {
  const admin = await requireAdmin();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const row = await getClassWithCourse(id);
  if (!row) notFound();
  return (
    <>
      <Link href={`/admin/classes/${id}`} className="text-sm text-pine-700 underline">{row.course.name}: {row.klass.code}</Link>
      <PageHeader title="Daily attendance" description="Mark or correct attendance for any date. You can sign a day on the instructor's behalf." />
      <DayAttendance klass={row.klass} viewer={admin} basePath={`/admin/classes/${id}/attendance`} requestedDate={(await searchParams).date} />
    </>
  );
}
