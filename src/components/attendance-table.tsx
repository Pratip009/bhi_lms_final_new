import { Badge, Empty, Table, Td, fmtDate } from "./ui";
import { ATTENDANCE_LABEL } from "@/lib/queries";

const tone = { PRESENT: "pine", LATE: "marigold", ABSENT: "brick", EXCUSED: "neutral", HOLIDAY: "neutral" } as const;

export function AttendanceTable({ rows }: { rows: { date: string; status: keyof typeof tone; hours: number; note: string }[] }) {
  if (!rows.length) return <Empty>No attendance recorded yet.</Empty>;
  const present = rows.filter((r) => r.status === "PRESENT" || r.status === "LATE").length;
  const hours = rows.reduce((s, r) => s + Number(r.hours), 0);
  return (
    <>
      <p className="mb-3 text-sm text-slate-600">{present} of {rows.length} sessions attended, {hours.toFixed(1)} hours total.</p>
      <Table head={["Date", "Status", "Hours", "Note"]}>
        {rows.map((r) => (
          <tr key={r.date}>
            <Td>{fmtDate(r.date)}</Td>
            <Td><Badge tone={tone[r.status]}>{ATTENDANCE_LABEL[r.status]}</Badge></Td>
            <Td className="tabular-nums">{Number(r.hours).toFixed(1)}</Td>
            <Td className="text-slate-600">{r.note || "-"}</Td>
          </tr>
        ))}
      </Table>
    </>
  );
}
