import type { Metadata } from "next";
import Link from "next/link";
import { cols } from "@/db";
import { requireInstructor } from "@/lib/auth";
import { activeCourseIds, instructorClassFilter } from "@/lib/authz";
import { describeEnrollment } from "@/lib/forms/templates";
import { thisMonthLocal } from "@/lib/dates";
import { attendanceToDo, coursesById, usersById } from "@/lib/queries";
import { Alert, Badge, Card, Empty, PageHeader, Table, Td, fmtDate } from "@/components/ui";

export const metadata: Metadata = { title: "My courses" };
export const dynamic = "force-dynamic";

export default async function InstructorHome({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requireInstructor();
  const q = ((await searchParams).q ?? "").trim().toLowerCase().slice(0, 80);
  const { classes, enrollments, applications, progressReports } = await cols();
  const assigned = await activeCourseIds(user._id);
  const ks = await classes.find({ ...(await instructorClassFilter(user._id)), archived: false }).sort({ startDate: 1 }).toArray();
  const courseIds = [...new Set([...assigned, ...ks.map((k) => k.courseId)])];
  const cs = await coursesById(courseIds);
  const roster = await enrollments.find({ classId: { $in: ks.map((k) => k._id) }, status: "ACTIVE" }).toArray();
  const people = await usersById(roster.map((e) => e.studentId));
  const apps = new Map((await applications.find({ studentId: { $in: roster.map((e) => e.studentId) } }, { projection: { studentId: 1, category: 1, county: 1 } }).toArray()).map((a) => [a.studentId, a]));
  const month = thisMonthLocal();
  const reports = await progressReports.find({ enrollmentId: { $in: roster.map((e) => e._id) }, month }, { projection: { enrollmentId: 1, status: 1 } }).toArray();
  const toConfirm = await attendanceToDo(ks.map((k) => k._id));
  const codeOf = new Map(ks.map((k) => [k._id, k.code]));

  return (
    <>
      <PageHeader title="My courses" description="Your assigned courses and students. Open a student's attendance sheet or monthly progress report." />
      {toConfirm.length > 0 && (
        <div className="mb-5"><Alert tone="warning">
          <p className="font-semibold">Attendance waiting for you (fill-outs to complete or days to sign)</p>
          <ul className="mt-1 list-disc pl-5">
            {toConfirm.map((t) => (
              <li key={`${t.classId}:${t.date}`}>
                <Link href={`/instructor/classes/${t.classId}/attendance?date=${t.date}`} className="underline">{codeOf.get(t.classId)}, {fmtDate(t.date)}</Link>: {[t.pending ? `${t.pending} checked in, not filled out` : "", t.unsigned ? "not signed" : ""].filter(Boolean).join("; ")}
              </li>
            ))}
          </ul>
        </Alert></div>
      )}
      <form className="mb-5 flex gap-2">
        <input name="q" defaultValue={q} placeholder="Find a student" aria-label="Find a student" className="w-64 rounded-md border border-line px-3 py-2 text-sm" />
        <button className="rounded-md border border-line bg-white px-3 py-2 text-sm font-semibold">Search</button>
      </form>
      {courseIds.length === 0 ? <Empty>No courses assigned to you yet. An admin will assign your courses.</Empty> : (
        <div className="space-y-6">
          {courseIds.map((cid) => {
            const course = cs.get(cid);
            const sections = ks.filter((k) => k.courseId === cid);
            const rows = roster
              .filter((e) => sections.some((k) => k._id === e.classId) && people.has(e.studentId))
              .filter((e) => !q || people.get(e.studentId)!.name.toLowerCase().includes(q) || people.get(e.studentId)!.email.toLowerCase().includes(q))
              .sort((a, b) => people.get(a.studentId)!.name.localeCompare(people.get(b.studentId)!.name));
            return (
              <Card key={cid} title={course?.name ?? "Course"} actions={<span className="text-sm text-slate-600">{sections.length} class{sections.length === 1 ? "" : "es"}</span>}>
                {sections.length > 0 && (
                  <p className="mb-4 flex flex-wrap gap-3 text-sm">
                    {sections.map((k) => <Link key={k._id} href={`/instructor/classes/${k._id}`} className="text-pine-700 underline">{k.code} ({k.cohort}): roster and daily attendance</Link>)}
                  </p>
                )}
                {rows.length === 0 ? <Empty>{q ? "No students match." : "No students enrolled yet."}</Empty> : (
                  <Table head={["Student", "Program", "Class", "Attendance", `Progress report (${month})`]}>
                    {rows.map((e) => {
                      const u = people.get(e.studentId)!;
                      const a = apps.get(e.studentId);
                      const rep = reports.find((r) => r.enrollmentId === e._id);
                      return (
                        <tr key={e._id}>
                          <Td><p className="font-semibold">{u.name}</p><p className="text-slate-500">{u.email}</p></Td>
                          <Td>{a ? describeEnrollment(a) : "-"}</Td>
                          <Td>{codeOf.get(e.classId)}</Td>
                          <Td><Link href={`/instructor/attendance/${e._id}`} className="font-semibold text-pine-700 underline">Attendance Sheet</Link>
                            <span className="block text-xs text-slate-500">{a?.category === "EQISS" ? "Biweekly ITA report" : "Monthly handwritten sheet"}</span></Td>
                          <Td>
                            <Link href={`/instructor/reports/${e._id}/${month}`} className="font-semibold text-pine-700 underline">Monthly Progress Report</Link>
                            <span className="ml-2">{rep?.status === "SUBMITTED" ? <Badge tone="pine">Submitted</Badge> : rep ? <Badge tone="marigold">Draft</Badge> : <Badge tone="brick">Not started</Badge>}</span>
                          </Td>
                        </tr>
                      );
                    })}
                  </Table>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
