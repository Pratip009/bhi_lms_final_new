import type { Metadata } from "next";
import Link from "next/link";
import { cols } from "@/db";
import { requireAdmin } from "@/lib/auth";
import { activeCountsByClass } from "@/lib/queries";
import { CourseForm } from "@/components/action-widgets";
import { Badge, Card, Empty, PageHeader, Table, Td } from "@/components/ui";
import { saveCourseAction } from "../actions";
import { formatUsd } from "@/lib/payment";
import { feesTotalCents } from "@/lib/forms/templates";

export const metadata: Metadata = { title: "Courses and classes" };
const PROGRAM: Record<string, string> = { PRIVATE: "Private", EQISS: "EQISS / One-Stop", DFS: "DFS", MIXED: "Mixed" };

export default async function CoursesPage() {
  await requireAdmin();
  const { courses, classes } = await cols();
  const list = await courses.find({}).sort({ archived: 1, name: 1 }).toArray();
  const ks = await classes.find({ archived: false }, { projection: { courseId: 1 } }).toArray();
  const counts = await activeCountsByClass();

  return (
    <>
      <PageHeader title="Courses and classes" description="The BHI course list. Students choose a course when they enroll; approved students are placed in a class of that course automatically." />
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div>
          {list.length === 0 ? (
            <Empty>No courses yet. Add your first course to start creating classes.</Empty>
          ) : (
            <Table head={["Course", "Who can choose it", "Hours", "Private total", "Active classes", "Students", ""]}>
              {list.map((c) => {
                const cls = ks.filter((k) => k.courseId === c._id);
                const students = cls.reduce((n, k) => n + (counts.get(k._id) ?? 0), 0);
                return (
                  <tr key={c._id} className={c.archived ? "opacity-60" : undefined}>
                    <Td><Link href={`/admin/courses/${c._id}`} className="font-semibold text-pine-700 underline">{c.name}</Link>{c.archived && <span className="ml-2"><Badge>Archived</Badge></span>}</Td>
                    <Td>{c.fundingPrograms.map((p) => PROGRAM[p] ?? p).join(", ") || "Everyone"}</Td>
                    <Td className="tabular-nums">{c.hours ?? "-"}</Td>
                    <Td className="tabular-nums">{c.fees ? formatUsd(feesTotalCents(c.fees)) : <span className="text-marigold-700">Not set</span>}</Td>
                    <Td className="tabular-nums">{cls.length}</Td>
                    <Td className="tabular-nums">{students}</Td>
                    <Td><Link href={`/admin/courses/${c._id}`} className="text-pine-700 underline">Manage</Link></Td>
                  </tr>
                );
              })}
            </Table>
          )}
        </div>
        <Card title="Add a course"><CourseForm action={saveCourseAction.bind(null, null)} submitLabel="Add course" /></Card>
      </div>
    </>
  );
}
