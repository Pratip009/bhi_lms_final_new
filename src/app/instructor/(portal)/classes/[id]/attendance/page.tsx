import Link from "next/link";
import { notFound } from "next/navigation";
import { requireInstructor } from "@/lib/auth";
import { instructorTeachesClass } from "@/lib/authz";
import { getClassWithCourse } from "@/lib/queries";
import { PageHeader } from "@/components/ui";
import { DayAttendance } from "@/components/day-attendance";

export const dynamic = "force-dynamic";

export default async function TakeAttendance({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ date?: string }> }) {
  const user = await requireInstructor();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id) || !(await instructorTeachesClass(user._id, id))) notFound();
  const row = await getClassWithCourse(id);
  if (!row) notFound();
  return (
    <>
      <Link href={`/instructor/classes/${id}`} className="text-sm text-pine-700 underline">{row.course.name}: {row.klass.code}</Link>
      <PageHeader title="Daily attendance" description="Mark each student, check the times, save, then sign the day." />
      <DayAttendance klass={row.klass} viewer={user} basePath={`/instructor/classes/${id}/attendance`} requestedDate={(await searchParams).date} />
    </>
  );
}
