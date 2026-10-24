import Link from "next/link";
import type { loadMonthlySheet } from "@/lib/sheets";
import { saveDailyEntryAction, signMonthlySheetAction } from "@/lib/actions/sheets";
import { ATTENDANCE_LABEL } from "@/lib/queries";
import { Alert, Badge, Card, cx } from "./ui";
import { DailyEntryEditor } from "./daily-entry-editor";
import { PrintButton, SignForm } from "./sign-form";

type Sheet = NonNullable<Awaited<ReturnType<typeof loadMonthlySheet>>>;
const weekdayShort = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
const tone = { PRESENT: "pine", LATE: "marigold", ABSENT: "brick", EXCUSED: "neutral", HOLIDAY: "neutral" } as const;

/**
 * DFS / Private monthly attendance sheet, laid out like the handwritten sheet: one row per day with
 * start, lunch out, lunch in, end, the student's signature and notes, then the instructor's sign-off.
 */
export function MonthlySheet({ sheet, enrollmentId, month, months, basePath, mode, viewerName, signerNames }: {
  sheet: Sheet; enrollmentId: string; month: string; months: string[]; basePath: string;
  mode: "STAFF" | "VIEW"; viewerName: string; signerNames: Map<string, string>;
}) {
  const studentName = sheet.student?.name ?? "";
  const days = sheet.rows.filter((r) => r.record || (r.inClass && r.enrolled));
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <nav aria-label="Months" className="flex flex-wrap gap-1 text-sm">
          {months.map((m) => (
            <Link key={m} href={`${basePath}?month=${m}`} aria-current={m === month ? "page" : undefined}
              className={cx("rounded border px-2 py-1", m === month ? "border-pine-700 bg-pine-700 text-white" : "border-line bg-white hover:bg-mist")}>{m}</Link>
          ))}
        </nav>
        <PrintButton />
      </div>
      <Card title={`Monthly attendance: ${month}`}>
        <dl className="mb-4 grid gap-3 text-sm sm:grid-cols-4">
          <div><dt className="text-slate-500">Student</dt><dd className="font-medium">{studentName}</dd></div>
          <div><dt className="text-slate-500">Course</dt><dd className="font-medium">{sheet.course.name}</dd></div>
          <div><dt className="text-slate-500">Section</dt><dd className="font-medium">{sheet.klass.code}</dd></div>
          <div><dt className="text-slate-500">Totals</dt><dd className="font-medium">{sheet.totals.hours.toFixed(2)} h · {sheet.totals.present} present · {sheet.totals.absent} absent · {sheet.totals.holiday} holiday</dd></div>
        </dl>
        {days.length === 0 ? <p className="text-sm text-slate-600">No class days in this month yet.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-left text-sm">
              <thead className="bg-mist text-xs font-semibold text-slate-600">
                <tr>{["Date", "Start time", "Lunch out", "Lunch in", "End time", "Hours", "Status", "Student signature", "Notes", ""].map((h) => <th key={h} className="border border-line px-2 py-2">{h}</th>)}</tr>
              </thead>
              <tbody>
                {days.map(({ date, record: r, inClass, enrolled }) => (
                  <tr key={date} className="align-top">
                    <td className="whitespace-nowrap border border-line px-2 py-2">{weekdayShort(date)} {date.slice(5)}</td>
                    <td className="border border-line px-2 py-2 tabular-nums">{r?.startTime || ""}</td>
                    <td className="border border-line px-2 py-2 tabular-nums">{r?.lunchOut || ""}</td>
                    <td className="border border-line px-2 py-2 tabular-nums">{r?.lunchIn || ""}</td>
                    <td className="border border-line px-2 py-2 tabular-nums">{r?.endTime || ""}</td>
                    <td className="border border-line px-2 py-2 tabular-nums">{r ? Number(r.hours).toFixed(2) : ""}</td>
                    <td className="border border-line px-2 py-2">{r && <Badge tone={tone[r.status]}>{ATTENDANCE_LABEL[r.status]}</Badge>}</td>
                    <td className="border border-line px-2 py-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {r?.studentSignature ? <img src={r.studentSignature.imageDataUrl} alt={`Signature of ${studentName} for ${date}`} className="h-8 max-w-[140px]" /> : ""}
                    </td>
                    <td className="border border-line px-2 py-2 text-slate-600">{r?.note || ""}</td>
                    <td className="border border-line px-2 py-2 print:hidden">
                      {mode === "STAFF" && inClass && enrolled && (
                        <details>
                          <summary className="cursor-pointer text-sm font-semibold text-pine-700">{r ? "Edit" : "Enter"}</summary>
                          <div className="mt-3 w-[min(560px,80vw)]">
                            <DailyEntryEditor action={saveDailyEntryAction.bind(null, enrollmentId, date)} studentName={studentName}
                              values={{ status: r?.status, startTime: r?.startTime, lunchOut: r?.lunchOut, lunchIn: r?.lunchIn, endTime: r?.endTime, hours: r?.hours, note: r?.note, signed: !!r?.studentSignature }} />
                          </div>
                        </details>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card title="Instructor sign-off">
        {sheet.signoff ? (
          <div className="mb-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={sheet.signoff.signature.imageDataUrl} alt={`Signature of ${sheet.signoff.signature.signerName}`} className="h-14 rounded border border-line bg-white" />
            <p className="mt-1 text-sm">{sheet.signoff.signature.signerName}, {sheet.signoff.signature.signedAt.toISOString().slice(0, 16).replace("T", " ")} UTC</p>
            {sheet.changedSinceSignoff && <div className="mt-2"><Alert tone="warning">Entries changed after this sign-off. The instructor should review and sign again.</Alert></div>}
            {sheet.signoff.history.length > 0 && (
              <p className="mt-2 text-xs text-slate-500">Earlier sign-offs: {sheet.signoff.history.map((h) => `${h.signature.signerName} (${h.signature.signedAt.toISOString().slice(0, 10)})`).join(", ")}</p>
            )}
          </div>
        ) : <p className="mb-4 text-sm text-slate-600">Not signed yet.</p>}
        {mode === "STAFF" && (!sheet.signoff || sheet.changedSinceSignoff) && sheet.rows.some((r) => r.record) && (
          <div className="print:hidden">
            <SignForm action={signMonthlySheetAction.bind(null, enrollmentId, month)} defaultName={viewerName} label="Sign and approve this month" />
          </div>
        )}
        {signerNames.size > 0 && <p className="mt-3 text-xs text-slate-500">Entries recorded by: {[...signerNames.values()].join(", ")}</p>}
      </Card>
    </div>
  );
}
