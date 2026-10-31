"use client";

import { useState } from "react";
import type { ActionState } from "@/lib/action";
import { ActionForm, Field, Submit, useFormCtx } from "./forms";
import { SignaturePad } from "./signature-pad";

type Values = { status?: string; startTime?: string; lunchOut?: string; lunchIn?: string; endTime?: string; hours?: number; note?: string; signed: boolean };

function StatusPicker({ value }: { value?: string }) {
  const { state } = useFormCtx();
  return (
    <fieldset>
      <legend className="mb-1.5 text-sm font-medium">Status</legend>
      <div className="flex flex-wrap gap-1">
        {[["PRESENT", "Present"], ["LATE", "Late"], ["ABSENT", "Absent"], ["SICK", "Sick"], ["HOLIDAY", "Holiday"], ["EXCUSED", "Excused"]].map(([v, l]) => (
          <label key={v} className="cursor-pointer rounded border border-line px-2 py-1 text-xs has-[:checked]:border-pine-700 has-[:checked]:bg-pine-700 has-[:checked]:text-white">
            <input type="radio" name="status" value={v} defaultChecked={(value ?? "PRESENT") === v} className="sr-only" />{l}
          </label>
        ))}
      </div>
      {state.fieldErrors?.status && <p className="text-xs text-brick-600">{state.fieldErrors.status}</p>}
    </fieldset>
  );
}

/** Edit one day of a monthly handwritten sheet (instructors and admins). */
export function DailyEntryEditor({ action, values, studentName }: { action: (p: ActionState, fd: FormData) => Promise<ActionState>; values: Values; studentName: string }) {
  const [sign, setSign] = useState(false);
  return (
    <ActionForm action={action} className="space-y-3">
      <StatusPicker value={values.status} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field name="startTime" label="Start time" type="time" defaultValue={values.startTime ?? ""} />
        <Field name="lunchOut" label="Lunch out" type="time" defaultValue={values.lunchOut ?? ""} />
        <Field name="lunchIn" label="Lunch in" type="time" defaultValue={values.lunchIn ?? ""} />
        <Field name="endTime" label="End time" type="time" defaultValue={values.endTime ?? ""} />
      </div>
      <div className="grid gap-3 sm:grid-cols-[120px_1fr]">
        <Field name="hours" label="Hours" type="number" defaultValue={values.hours !== undefined ? String(values.hours) : ""} help="Calculated from the times when given" />
        <Field name="note" label="Notes" defaultValue={values.note ?? ""} maxLength={300} />
      </div>
      {sign ? (
        <SignaturePad defaultName={studentName} />
      ) : (
        <button type="button" onClick={() => setSign(true)} className="text-sm font-semibold text-pine-700 underline">
          {values.signed ? "Replace student signature" : "Add student signature (student signs on this device)"}
        </button>
      )}
      <Submit>Save day</Submit>
    </ActionForm>
  );
}
