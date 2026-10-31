"use client";

import { useRef } from "react";
import type { ActionState } from "@/lib/action";
import { ActionForm, Submit, useFormCtx } from "@/components/forms";

export type DayRow = {
  enrollmentId: string; name: string; status?: string; timeIn?: string; timeOut?: string; note?: string; hours?: number;
  checkedIn?: { time: string; late: boolean; sameAs: string[] }; left?: boolean;
};
const STATUSES: [string, string][] = [["PRESENT", "Present"], ["LATE", "Late"], ["ABSENT", "Absent"], ["SICK", "Sick"], ["HOLIDAY", "Holiday"], ["EXCUSED", "Excused"]];

function Rows({ rows, start, end }: { rows: DayRow[]; start: string; end: string }) {
  const { state } = useFormCtx();
  const err = (k: string) => state.fieldErrors?.[k];
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-white">
      <table className="w-full min-w-[860px] text-sm">
        <thead className="bg-mist text-left text-xs font-semibold text-slate-600">
          <tr><th className="px-3 py-2.5">Student</th><th className="px-3 py-2.5">Attendance</th><th className="px-3 py-2.5">Time in</th><th className="px-3 py-2.5">Time out</th><th className="px-3 py-2.5">Note</th></tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => (
            <tr key={r.enrollmentId} data-row={r.enrollmentId}>
              <td className="px-3 py-3">
                <span className="font-semibold">{r.name}</span>
                {r.left && <span className="block text-xs text-slate-500">Has since left this class</span>}
                {r.checkedIn && (
                  <span className={`mt-0.5 block text-xs ${r.checkedIn.sameAs.length ? "text-marigold-700" : "text-pine-700"}`}>
                    Checked in {r.checkedIn.time}{r.checkedIn.late ? " (late)" : ""}{r.checkedIn.sameAs.length ? ", same phone as " + r.checkedIn.sameAs.join(", ") : ""}
                  </span>
                )}
                {r.hours !== undefined && r.status && <span className="block text-xs text-slate-500">{r.hours.toFixed(2)} h counted</span>}
              </td>
              <td className="px-3 py-3">
                <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={`Attendance for ${r.name}`}>
                  {STATUSES.map(([v, l]) => (
                    <label key={v} className="cursor-pointer rounded border border-line px-2.5 py-1.5 text-xs font-medium has-[:checked]:border-pine-700 has-[:checked]:bg-pine-700 has-[:checked]:text-white">
                      <input type="radio" name={`status_${r.enrollmentId}`} value={v} defaultChecked={r.status === v} className="sr-only" />{l}
                    </label>
                  ))}
                </div>
                {err(`status_${r.enrollmentId}`) && <p className="text-xs text-brick-600">{err(`status_${r.enrollmentId}`)}</p>}
              </td>
              <td className="px-3 py-3">
                <input type="time" name={`timeIn_${r.enrollmentId}`} defaultValue={r.timeIn || start} aria-label={`Time in for ${r.name}`} className="w-28 rounded-md border border-line px-2 py-1" />
                {err(`timeIn_${r.enrollmentId}`) && <p className="text-xs text-brick-600">{err(`timeIn_${r.enrollmentId}`)}</p>}
              </td>
              <td className="px-3 py-3">
                <input type="time" name={`timeOut_${r.enrollmentId}`} defaultValue={r.timeOut || end} aria-label={`Time out for ${r.name}`} className="w-28 rounded-md border border-line px-2 py-1" />
                {err(`timeOut_${r.enrollmentId}`) && <p className="text-xs text-brick-600">{err(`timeOut_${r.enrollmentId}`)}</p>}
              </td>
              <td className="px-3 py-3"><input name={`note_${r.enrollmentId}`} defaultValue={r.note} maxLength={300} aria-label={`Note for ${r.name}`} className="w-full rounded-md border border-line px-2 py-1" /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Daily attendance: pick a status for each student; time in and out start at the class times and can be
 * changed. Hours are calculated (the class break is deducted). Times are ignored for absent, sick,
 * holiday and excused.
 */
export function AttendanceForm({ action, date, rows, start, end }: { action: (p: ActionState, fd: FormData) => Promise<ActionState>; date: string; rows: DayRow[]; start: string; end: string }) {
  const ref = useRef<HTMLDivElement>(null);
  function allPresent() {
    ref.current?.querySelectorAll<HTMLInputElement>('input[type="radio"][value="PRESENT"]').forEach((el) => {
      const group = ref.current!.querySelectorAll<HTMLInputElement>(`input[name="${el.name}"]:checked`);
      if (!group.length) el.checked = true;
    });
  }
  return (
    <ActionForm action={action} className="space-y-4">
      <input type="hidden" name="date" value={date} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600">{start && end ? `Times start at the class times (${start}–${end}); change them for anyone who came late or left early.` : "Set the class times in Class settings so time in and out are filled in for you."}</p>
        <button type="button" onClick={allPresent} className="rounded-md border border-line bg-white px-3 py-1.5 text-sm font-semibold">Mark everyone not yet marked as present</button>
      </div>
      <div ref={ref}><Rows rows={rows} start={start} end={end} /></div>
      <Submit>Save attendance</Submit>
    </ActionForm>
  );
}
