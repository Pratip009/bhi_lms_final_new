"use client";

import type { ActionState } from "@/lib/action";
import type { BiweeklyDay, BiweeklyHeader } from "@/db/types";
import { ActionForm, Submit, useFormCtx } from "./forms";
import { cx } from "./ui";

type Mode = "STAFF" | "CUSTOMER" | "VIEW";
const DAY = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const cell = "border border-line px-1 py-1";
const inp = "w-full min-w-[64px] rounded border border-line px-1 py-1 text-xs disabled:border-transparent disabled:bg-transparent";

function HeaderField({ name, label, value, mode, type = "text" }: { name: keyof BiweeklyHeader; label: string; value: string | number; mode: Mode; type?: string }) {
  const { state } = useFormCtx();
  const err = state.fieldErrors?.[name];
  return (
    <label className="block text-xs">
      <span className="text-slate-500">{label}</span>
      <input name={name} type={type} defaultValue={String(value ?? "")} disabled={mode !== "STAFF"}
        className={cx("mt-0.5 block w-full rounded border px-2 py-1 text-sm disabled:border-transparent disabled:bg-transparent disabled:px-0 disabled:font-medium", err ? "border-brick-600" : "border-line")} />
      {err && <span className="text-brick-600">{err}</span>}
    </label>
  );
}

function Week({ days, offset, mode }: { days: BiweeklyDay[]; offset: number; mode: Mode }) {
  const { state } = useFormCtx();
  const staff = mode === "STAFF";
  const row = (label: string, render: (d: BiweeklyDay, i: number) => React.ReactNode) => (
    <tr><th scope="row" className={cx(cell, "bg-mist text-left text-xs font-semibold")}>{label}</th>{days.map((d, j) => <td key={d.date} className={cell}>{render(d, offset + j)}</td>)}</tr>
  );
  const err = (k: string) => state.fieldErrors?.[k] ? <span className="block text-[10px] text-brick-600">{state.fieldErrors[k]}</span> : null;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[820px] border-collapse text-xs">
        <thead><tr><th className={cx(cell, "bg-mist")}>Week {offset === 0 ? 1 : 2}</th>{days.map((d, j) => <th key={d.date} className={cx(cell, "bg-mist")}>{DAY[j]}</th>)}</tr></thead>
        <tbody>
          {row("Date", (d) => <span className="tabular-nums">{d.date.slice(5).replace("-", "/")}</span>)}
          {row("Time in", (d, i) => <><input name={`timeIn_${i}`} type="time" defaultValue={d.timeIn} disabled={!staff} className={inp} aria-label={`Time in ${d.date}`} />{err(`timeIn_${i}`)}</>)}
          {row("Time out", (d, i) => <><input name={`timeOut_${i}`} type="time" defaultValue={d.timeOut} disabled={!staff} className={inp} aria-label={`Time out ${d.date}`} />{err(`timeOut_${i}`)}</>)}
          {row("A / H / S", (d, i) => (
            <select name={`code_${i}`} defaultValue={d.code} disabled={!staff} className={inp} aria-label={`Absent, holiday or sick on ${d.date}`}>
              <option value="">–</option><option value="A">A</option><option value="H">H</option><option value="S">S</option>
            </select>
          ))}
          {row("Customer's initials", (d, i) => <input name={`customerInitials_${i}`} defaultValue={d.customerInitials} maxLength={6} disabled={mode === "VIEW"} className={inp} aria-label={`Customer's initials ${d.date}`} />)}
          {row("Instructor's initials", (d, i) => <input name={`instructorInitials_${i}`} defaultValue={d.instructorInitials} maxLength={6} disabled={!staff} className={inp} aria-label={`Instructor's initials ${d.date}`} />)}
          {row("Total hours", (d) => <span className="tabular-nums">{d.hours ? d.hours.toFixed(2) : ""}</span>)}
        </tbody>
      </table>
    </div>
  );
}

export function BiweeklyForm({ action, header, days, comments, progress, mode, studentName, totals }: {
  action: (p: ActionState, fd: FormData) => Promise<ActionState>; header: BiweeklyHeader; days: BiweeklyDay[]; comments: string;
  progress: { courseGrades: string; indicator: string; additionalComments: string }; mode: Mode; studentName: string;
  totals: { total: number; cumulative: number; periodStart: string; periodEnd: string };
}) {
  const staff = mode === "STAFF";
  return (
    <ActionForm action={action} className="space-y-5">
      <section className="grid gap-3 rounded-lg border border-line bg-white p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="text-xs"><span className="text-slate-500">Customer / student</span><p className="mt-0.5 text-sm font-medium">{studentName}</p></div>
        <div className="text-xs">
          <span className="text-slate-500">SSN</span>
          {staff ? <HeaderField name="ssnLast4" label="Last 4 digits (shown masked)" value={header.ssnLast4} mode={mode} />
            : <p className="mt-0.5 text-sm font-medium tabular-nums">XXX-XX-{header.ssnLast4 || "____"}</p>}
        </div>
        <HeaderField name="contractNumber" label="Contract number" value={header.contractNumber} mode={mode} />
        <HeaderField name="caseManager" label="Case manager" value={header.caseManager} mode={mode} />
        <HeaderField name="schoolName" label="School name" value={header.schoolName} mode={mode} />
        <HeaderField name="trainingLocation" label="Training location" value={header.trainingLocation} mode={mode} />
        <HeaderField name="trainingName" label="Training / course name" value={header.trainingName} mode={mode} />
        <HeaderField name="totalProgramHours" label="Total program hours" value={header.totalProgramHours} mode={mode} type="number" />
        <HeaderField name="programStart" label="Program start date" value={header.programStart} mode={mode} type="date" />
        <HeaderField name="programEnd" label="Program end date" value={header.programEnd} mode={mode} type="date" />
        <div className="text-xs"><span className="text-slate-500">Biweekly start – end date</span><p className="mt-0.5 text-sm font-medium tabular-nums">{totals.periodStart} – {totals.periodEnd}</p></div>
        <HeaderField name="scheduledHours" label="Biweekly scheduled hours" value={header.scheduledHours} mode={mode} type="number" />
      </section>

      <Week days={days.slice(0, 7)} offset={0} mode={mode} />
      <Week days={days.slice(7, 14)} offset={7} mode={mode} />

      <div className="grid gap-3 sm:grid-cols-2">
        <p className="rounded-md border border-line bg-white p-3 text-sm">Total biweekly hours attended: <strong className="tabular-nums">{totals.total.toFixed(2)}</strong></p>
        <p className="rounded-md border border-line bg-white p-3 text-sm">Cumulative attended program hours: <strong className="tabular-nums">{totals.cumulative.toFixed(2)}</strong></p>
      </div>

      <section className="space-y-3 rounded-lg border border-line bg-white p-4">
        <label className="block text-sm"><span className="font-medium">Comments</span>
          <textarea name="comments" defaultValue={comments} rows={3} disabled={!staff} className="mt-1 block w-full rounded border border-line px-2 py-1 disabled:bg-mist" /></label>
        <h3 className="pt-2 text-sm font-semibold">Biweekly progress report</h3>
        <label className="block text-sm"><span className="font-medium">Current course / activity grades</span>
          <textarea name="courseGrades" defaultValue={progress.courseGrades} rows={2} disabled={!staff} className="mt-1 block w-full rounded border border-line px-2 py-1 disabled:bg-mist" /></label>
        <fieldset disabled={!staff} className="flex flex-wrap gap-4 text-sm">
          <legend className="sr-only">Progress indicator</legend>
          {[["ABOVE_AVERAGE", "Above average"], ["BELOW_AVERAGE", "Below average"], ["", "Not marked"]].map(([v, l]) => (
            <label key={v} className="flex items-center gap-2"><input type="radio" name="indicator" value={v} defaultChecked={progress.indicator === v} className="accent-pine-700" /> {l}</label>
          ))}
        </fieldset>
        <label className="block text-sm"><span className="font-medium">Additional comments</span>
          <textarea name="additionalComments" defaultValue={progress.additionalComments} rows={3} disabled={!staff} className="mt-1 block w-full rounded border border-line px-2 py-1 disabled:bg-mist" /></label>
      </section>
      {mode !== "VIEW" && <div className="print:hidden"><Submit>{mode === "CUSTOMER" ? "Save my initials" : "Save report"}</Submit></div>}
    </ActionForm>
  );
}
