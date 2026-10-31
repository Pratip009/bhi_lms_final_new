import { todayLocal } from "@/lib/dates";
import { AttendanceTabs } from "@/components/attendance-tabs";
import type { Metadata } from "next";
import Link from "next/link";
import { cols } from "@/db";
import { requireAdmin } from "@/lib/auth";
import { ATTENDANCE_LABEL, classOptions, searchAttendance } from "@/lib/queries";
import { Empty, PageHeader, Table, Td, fmtDate } from "@/components/ui";

export const metadata: Metadata = { title: "Attendance" };
const isDate = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
const isId = (s?: string) => !!s && /^[0-9a-f-]{36}$/.test(s);

export default async function AdminAttendance({ searchParams }: { searchParams: Promise<{ classId?: string; studentId?: string; from?: string; to?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const options = await classOptions();
  const students = await (await cols()).users.find({ role: "STUDENT" }, { projection: { _id: 1, name: 1 } }).sort({ name: 1 }).limit(2000).toArray();
  // With no filter chosen, show the last 7 days so the page is never empty.
  const anyFilter = isId(sp.classId) || isId(sp.studentId) || isDate(sp.from) || isDate(sp.to);
  const today = todayLocal();
  const weekAgo = todayLocal(new Date(Date.now() - 6 * 86_400_000));
  const q = {
    classId: isId(sp.classId) ? sp.classId : undefined,
    studentId: isId(sp.studentId) ? sp.studentId : undefined,
    from: isDate(sp.from) ? sp.from : anyFilter ? undefined : weekAgo,
    to: isDate(sp.to) ? sp.to : anyFilter ? undefined : today,
  };
  const filtered = Object.values(q).some(Boolean);
  const rows = filtered ? await searchAttendance({ ...q, limit: 1000 }) : [];
  const qs = new URLSearchParams(Object.entries(q).filter(([, v]) => v) as [string, string][]).toString();

  return (
    <>
      <AttendanceTabs active="records" />
      <PageHeader title="Attendance records" description="The last 7 days are shown. Choose a class, student or dates to see others. To mark or correct a day, open the class and choose Daily attendance." />
      <form className="mb-5 grid gap-3 rounded-lg border border-line bg-white p-4 sm:grid-cols-5">
        <select name="classId" defaultValue={sp.classId ?? ""} aria-label="Class" className="rounded-md border border-line bg-white px-3 py-2 text-sm">
          <option value="">All classes</option>
          {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
        <select name="studentId" defaultValue={sp.studentId ?? ""} aria-label="Student" className="rounded-md border border-line bg-white px-3 py-2 text-sm">
          <option value="">All students</option>
          {students.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
        </select>
        <input type="date" name="from" defaultValue={q.from} aria-label="From" className="rounded-md border border-line px-3 py-2 text-sm" />
        <input type="date" name="to" defaultValue={q.to} aria-label="To" className="rounded-md border border-line px-3 py-2 text-sm" />
        <button className="rounded-md bg-pine-700 px-3 py-2 text-sm font-semibold text-white">Show records</button>
      </form>
      {!filtered ? <Empty>Choose a class, student or date range to see attendance.</Empty> : rows.length === 0 ? <Empty>No records match.</Empty> : (
        <>
          <div className="mb-3 flex justify-end"><a href={`/api/export/attendance?${qs}`} className="text-sm font-semibold text-pine-700 underline">Export these records (CSV)</a></div>
          <Table head={["Date", "Student", "Class", "Status", "Hours", "Note"]}>
            {rows.map((r) => (
              <tr key={`${r.date}-${r.classId}-${r.studentId}`}>
                <Td>{fmtDate(r.date)}</Td>
                <Td><Link href={`/admin/students/${r.studentId}`} className="underline">{r.student}</Link></Td>
                <Td><Link href={`/admin/classes/${r.classId}`} className="underline">{r.code}</Link></Td>
                <Td>{ATTENDANCE_LABEL[r.status]}</Td>
                <Td className="tabular-nums">{r.hours.toFixed(1)}</Td>
                <Td className="text-slate-600">{r.note || "-"}</Td>
              </tr>
            ))}
          </Table>
        </>
      )}
    </>
  );
}
