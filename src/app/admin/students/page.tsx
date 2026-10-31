import type { Metadata } from "next";
import Link from "next/link";
import type { Filter } from "mongodb";
import { cols, type Application } from "@/db";
import { requireAdmin } from "@/lib/auth";
import { CATEGORIES, CATEGORY_LABELS, COUNTIES, COUNTY_LABELS, describeEnrollment } from "@/lib/forms/templates";
import { classOptions, regexSafe, usersById } from "@/lib/queries";
import { AssignClassForm } from "@/components/action-widgets";
import { Empty, PageHeader, Table, Td, cx } from "@/components/ui";
import { assignStudentAction } from "../actions";

export const metadata: Metadata = { title: "Students" };

export default async function StudentsPage({ searchParams }: { searchParams: Promise<{ filter?: string; q?: string; course?: string; category?: string; county?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const onlyUnassigned = sp.filter === "unassigned";
  const q = (sp.q ?? "").trim().slice(0, 80);
  const { applications, users, enrollments, classes, courses } = await cols();
  const where: Filter<Application> = { status: "APPROVED" };
  const category = CATEGORIES.find((c) => c === sp.category);
  if (category) where.category = category;
  const county = COUNTIES.find((c) => c === sp.county);
  if (county) where.county = county;
  const courseFilter = sp.course && /^[0-9a-f-]{36}$/.test(sp.course) ? sp.course : null;
  const allCourses = await courses.find({}, { projection: { name: 1 } }).sort({ name: 1 }).toArray();
  if (q) {
    const rx = { $regex: regexSafe(q), $options: "i" };
    const matches = await users.find({ role: "STUDENT", $or: [{ name: rx }, { email: rx }] }, { projection: { _id: 1 } }).limit(500).toArray();
    where.studentId = { $in: matches.map((u) => u._id) };
  }
  if (courseFilter) {
    // Students currently enrolled in any section of the course.
    const sectionIds = (await classes.find({ courseId: courseFilter }, { projection: { _id: 1 } }).toArray()).map((k) => k._id);
    const ids: string[] = await enrollments.distinct("studentId", { classId: { $in: sectionIds }, status: "ACTIVE" });
    where.studentId = where.studentId ? { $in: ids.filter((x) => (where.studentId as { $in: string[] }).$in.includes(x)) } : { $in: ids };
  }
  const apps = await applications.find(where, { projection: { studentId: 1, category: 1, county: 1 } }).limit(500).toArray();
  const people = await usersById(apps.map((a) => a.studentId));
  const active = await enrollments.find({ status: "ACTIVE", studentId: { $in: apps.map((a) => a.studentId) } }).toArray();
  const classCodes = new Map((await classes.find({ _id: { $in: active.map((e) => e.classId) } }, { projection: { code: 1 } }).toArray()).map((k) => [k._id, k.code]));
  const rows = apps
    .filter((a) => people.has(a.studentId))
    .map((a) => ({ user: people.get(a.studentId)!, category: a.category, label: describeEnrollment(a), classes: active.filter((e) => e.studentId === a.studentId).map((e) => ({ classId: e.classId, enrollmentId: e._id, code: classCodes.get(e.classId) ?? "" })) }))
    .filter((s) => !onlyUnassigned || s.classes.length === 0)
    .sort((a, b) => Number(a.classes.length > 0) - Number(b.classes.length > 0) || a.user.name.localeCompare(b.user.name));
  const options = await classOptions();

  return (
    <>
      <PageHeader title="Students" description="Approved students, their classes and attendance sheets. Approval places students in their chosen course automatically." />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {[["", "All approved"], ["unassigned", "No class yet"]].map(([k, l]) => (
          <Link key={k} href={`/admin/students${k ? `?filter=${k}` : ""}`}
            className={cx("rounded-md border px-3 py-1.5 text-sm", (sp.filter ?? "") === k ? "border-pine-700 bg-pine-700 text-white" : "border-line bg-white")}>{l}</Link>
        ))}
        <form className="ml-auto flex flex-wrap gap-2">
          {onlyUnassigned && <input type="hidden" name="filter" value="unassigned" />}
          <select name="course" defaultValue={courseFilter ?? ""} aria-label="Course" className="rounded-md border border-line bg-white px-3 py-1.5 text-sm">
            <option value="">All courses</option>{allCourses.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
          </select>
          <select name="category" defaultValue={sp.category ?? ""} aria-label="Program" className="rounded-md border border-line bg-white px-3 py-1.5 text-sm">
            <option value="">All programs</option>{CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
          </select>
          <select name="county" defaultValue={sp.county ?? ""} aria-label="County" className="rounded-md border border-line bg-white px-3 py-1.5 text-sm">
            <option value="">All counties</option>{COUNTIES.map((c) => <option key={c} value={c}>{COUNTY_LABELS[c]}</option>)}
          </select>
          <input name="q" defaultValue={q} placeholder="Search name or email" aria-label="Search" className="w-56 rounded-md border border-line px-3 py-1.5 text-sm" />
          <button className="rounded-md border border-line bg-white px-3 py-1.5 text-sm font-semibold">Search</button>
        </form>
      </div>
      {!options.length && <p className="mb-4 text-sm text-slate-600">No active classes yet. <Link href="/admin/courses" className="text-pine-700 underline">Create a course and class</Link> first.</p>}
      {rows.length === 0 ? (
        <Empty>No students match.</Empty>
      ) : (
        <Table head={["Student", "Program", "Classes and attendance", "Add to another class"]}>
          {rows.map(({ user, label, classes: ks }) => (
            <tr key={user._id}>
              <Td><Link href={`/admin/students/${user._id}`} className="font-semibold text-pine-700 underline">{user.name}</Link><p className="text-slate-500">{user.email}</p></Td>
              <Td>{label}</Td>
              <Td>{ks.length ? ks.map((c) => (
                <span key={c.classId} className="mr-3 inline-block">
                  <Link href={`/admin/classes/${c.classId}`} className="underline">{c.code}</Link>{" "}
                  (<Link href={`/admin/attendance/sheets/${c.enrollmentId}`} className="text-pine-700 underline">sheet</Link>)
                </span>
              )) : <span className="font-semibold text-marigold-700">None</span>}</Td>
              <Td className="min-w-[340px]">{options.length > 0 && <AssignClassForm action={assignStudentAction} studentId={user._id} classes={options} />}</Td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}
