import type { Metadata } from "next";
import Link from "next/link";
import { cols } from "@/db";
import { requireAdmin } from "@/lib/auth";
import { coursesById, usersById } from "@/lib/queries";
import { Badge, Empty, PageHeader, Table, Td } from "@/components/ui";
import { thisMonthLocal } from "@/lib/dates";

export const metadata: Metadata = { title: "Progress reports" };

export default async function AdminReports({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? sp.month! : thisMonthLocal();
  const { enrollments, classes, progressReports } = await cols();
  const active = await enrollments.find({ status: "ACTIVE" }).toArray();
  const ks = await classes.find({ _id: { $in: active.map((e) => e.classId) } }).toArray();
  const cs = await coursesById(ks.map((k) => k.courseId));
  const people = await usersById([...active.map((e) => e.studentId), ...ks.flatMap((k) => k.instructors.map((i) => i.instructorId))]);
  const reports = await progressReports.find({ month }, { projection: { data: 0 } }).toArray();
  const rows = active
    .map((e) => {
      const klass = ks.find((k) => k._id === e.classId)!;
      const leadId = klass.instructors.find((i) => i.role === "LEAD")?.instructorId;
      return { e, klass, course: cs.get(klass.courseId), student: people.get(e.studentId), lead: leadId ? people.get(leadId) : undefined, rep: reports.find((r) => r.enrollmentId === e._id) };
    })
    .sort((a, b) => a.klass.code.localeCompare(b.klass.code) || (a.student?.name ?? "").localeCompare(b.student?.name ?? ""));
  const submitted = rows.filter((r) => r.rep?.status === "SUBMITTED").length;

  return (
    <>
      <PageHeader title="Monthly progress reports" description={`${submitted} of ${rows.length} active students have a submitted report for ${month}.`} />
      <form className="mb-5 flex items-center gap-2 text-sm">
        <label htmlFor="month">Month</label>
        <input id="month" type="month" name="month" defaultValue={month} className="rounded-md border border-line px-2 py-1.5" />
        <button className="rounded-md border border-line bg-white px-3 py-1.5 font-semibold">Show</button>
      </form>
      {rows.length === 0 ? <Empty>No active enrollments.</Empty> : (
        <Table head={["Student", "Class", "Lead instructor", "Report"]}>
          {rows.map(({ e, klass, course, student, lead, rep }) => (
            <tr key={e._id}>
              <Td><Link href={`/admin/students/${e.studentId}`} className="font-semibold text-pine-700 underline">{student?.name}</Link></Td>
              <Td><Link href={`/admin/classes/${klass._id}`} className="underline">{course?.name}: {klass.code}</Link></Td>
              <Td>{lead ? <Link href={`/admin/instructors/${lead._id}?month=${month}`} className="underline">{lead.name}</Link> : <span className="text-marigold-700">None</span>}</Td>
              <Td>{rep ? <Link href={`/admin/reports/${rep._id}`} className="underline"><Badge tone={rep.status === "SUBMITTED" ? "pine" : "marigold"}>{rep.status === "SUBMITTED" ? "Submitted" : "Draft"}</Badge></Link> : <Badge tone="brick">Missing</Badge>}</Td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}
