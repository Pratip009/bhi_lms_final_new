"use client";

import type { ActionState } from "@/lib/action";
import { ActionForm, Submit, useFormCtx } from "@/components/forms";

type Row = { enrollmentId: string; name: string; status?: string; hours?: string; note?: string; checkedIn?: { time: string; late: boolean; sameAs: string[] } };

function Rows({ rows, defaultHours }: { rows: Row[]; defaultHours: number }) {
  const { state } = useFormCtx();
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-white">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="bg-mist text-left text-xs font-semibold text-slate-600">
          <tr><th className="px-4 py-2.5">Student</th><th className="px-4 py-2.5">Status</th><th className="px-4 py-2.5">Hours</th><th className="px-4 py-2.5">Note</th></tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => (
            <tr key={r.enrollmentId}>
              <td className="px-4 py-3">
                <span className="font-semibold">{r.name}</span>
                {r.checkedIn && (
                  <span className={`mt-0.5 block text-xs ${r.checkedIn.sameAs.length ? "text-marigold-700" : "text-pine-700"}`}>
                    Checked in {r.checkedIn.time}{r.checkedIn.late ? " (late)" : ""}{r.checkedIn.sameAs.length ? ", same phone as " + r.checkedIn.sameAs.join(", ") : ""}
                  </span>
                )}
              </td>
              <td className="px-4 py-3">
                <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={`Attendance for ${r.name}`}>
                  {[["PRESENT", "Present"], ["LATE", "Late"], ["ABSENT", "Absent"], ["EXCUSED", "Excused"]].map(([v, l]) => (
                    <label key={v} className="cursor-pointer rounded border border-line px-2 py-1 text-xs has-[:checked]:border-pine-700 has-[:checked]:bg-pine-700 has-[:checked]:text-white">
                      <input type="radio" name={`status_${r.enrollmentId}`} value={v} defaultChecked={r.status === v} className="sr-only" />{l}
                    </label>
                  ))}
                </div>
                {state.fieldErrors?.[`status_${r.enrollmentId}`] && <p className="text-xs text-brick-600">{state.fieldErrors[`status_${r.enrollmentId}`]}</p>}
              </td>
              <td className="px-4 py-3">
                <input type="number" step="0.25" min="0" max="24" name={`hours_${r.enrollmentId}`} defaultValue={r.hours ?? String(defaultHours)} aria-label={`Hours for ${r.name}`}
                  className="w-20 rounded-md border border-line px-2 py-1" />
                {state.fieldErrors?.[`hours_${r.enrollmentId}`] && <p className="text-xs text-brick-600">{state.fieldErrors[`hours_${r.enrollmentId}`]}</p>}
              </td>
              <td className="px-4 py-3"><input name={`note_${r.enrollmentId}`} defaultValue={r.note} maxLength={300} aria-label={`Note for ${r.name}`} className="w-full rounded-md border border-line px-2 py-1" /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AttendanceForm({ action, date, rows, defaultHours }: { action: (p: ActionState, fd: FormData) => Promise<ActionState>; date: string; rows: Row[]; defaultHours: number }) {
  return (
    <ActionForm action={action} className="space-y-4">
      <input type="hidden" name="date" value={date} />
      <Rows rows={rows} defaultHours={defaultHours} />
      <Submit>Save attendance</Submit>
    </ActionForm>
  );
}
