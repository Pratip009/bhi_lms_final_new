"use client";

import type { ActionState } from "@/lib/action";
import { ActionForm, Submit, useFormCtx } from "./forms";

type Act = (prev: ActionState, fd: FormData) => Promise<ActionState>;
export type ClassSettings = {
  classroomUrl: string; classroomSentAt: string | null;
  sessionStart: string; sessionEnd: string; breakStart: string; breakEnd: string;
  checkInEnabled?: boolean; lateAfterMinutes?: number | null;
};

function TimeInput({ name, label, value }: { name: string; label: string; value: string }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium">{label}</span>
      <input type="time" name={name} defaultValue={value} step={60} className="w-full rounded-md border border-line px-2 py-1.5 tabular-nums" />
    </label>
  );
}

/**
 * Instructor or admin: daily class times (time in/out start from these, the break is taken off as lunch),
 * when a student counts as late, and whether students check in with a code on their phone.
 */
export function ClassSettingsForm({ settings, save }: { settings: ClassSettings; save: Act; sendLink?: Act; studentCount?: number }) {
  return (
    <ActionForm action={save} className="space-y-4">
      <fieldset>
        <legend className="mb-1 text-sm font-medium">Class times</legend>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <TimeInput name="sessionStart" label="Class starts" value={settings.sessionStart} />
          <TimeInput name="sessionEnd" label="Class ends" value={settings.sessionEnd} />
          <TimeInput name="breakStart" label="Lunch starts" value={settings.breakStart} />
          <TimeInput name="breakEnd" label="Lunch ends" value={settings.breakEnd} />
        </div>
        <p className="mt-1 text-xs text-slate-600">Time in and out on the attendance sheet start from these times. Lunch is taken off the hours. Leave lunch empty if there is none.</p>
      </fieldset>
      <LateField value={settings.lateAfterMinutes} />
      <label className="flex items-start gap-3 rounded-md border border-line p-3 text-sm">
        <input type="checkbox" name="checkInEnabled" defaultChecked={!!settings.checkInEnabled} className="mt-0.5 h-4 w-4 accent-pine-700" />
        <span><strong>Students check in with a code on their phone</strong> (optional). When off, the instructor simply marks attendance on the sheet.</span>
      </label>
      <Submit>Save class settings</Submit>
    </ActionForm>
  );
}

function LateField({ value }: { value?: number | null }) {
  const { state } = useFormCtx();
  const err = state.fieldErrors?.lateAfterMinutes;
  return (
    <label className="block max-w-xs text-sm">
      <span className="mb-1 block font-medium">Late after (minutes past class start)</span>
      <input type="number" name="lateAfterMinutes" min={0} max={120} defaultValue={value ?? 10} className="w-24 rounded-md border border-line px-2 py-1.5" aria-invalid={!!err} />
      {err && <span className="mt-1 block text-xs font-medium text-brick-600">{err}</span>}
    </label>
  );
}
