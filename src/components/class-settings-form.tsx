"use client";

import type { ActionState } from "@/lib/action";
import { ActionForm, Submit, useFormCtx } from "./forms";

type Act = (prev: ActionState, fd: FormData) => Promise<ActionState>;
export type ClassSettings = {
  classroomUrl: string; classroomSentAt: string | null;
  sessionStart: string; sessionEnd: string; breakStart: string; breakEnd: string;
};

function TimeInput({ name, label, value }: { name: string; label: string; value: string }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium">{label}</span>
      <input type="time" name={name} defaultValue={value} step={60} className="w-full rounded-md border border-line px-2 py-1.5 tabular-nums" />
    </label>
  );
}

function LinkField({ value }: { value: string }) {
  const { state } = useFormCtx();
  const err = state.fieldErrors?.classroomUrl;
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium">Google Classroom link</span>
      <input type="url" name="classroomUrl" defaultValue={value} placeholder="https://classroom.google.com/c/..." maxLength={500} aria-invalid={!!err}
        className="w-full rounded-md border border-line px-3 py-2" />
      {err && <span className="mt-1 block text-xs font-medium text-brick-600">{err}</span>}
    </label>
  );
}

/** Instructor or admin: the class's Google Classroom link and daily class times. */
export function ClassSettingsForm({ settings, save, sendLink, studentCount }: { settings: ClassSettings; save: Act; sendLink: Act; studentCount: number }) {
  return (
    <div className="space-y-5">
      <ActionForm action={save} className="space-y-4">
        <LinkField value={settings.classroomUrl} />
        <fieldset>
          <legend className="mb-1 text-sm font-medium">Class times (used to count hours exactly)</legend>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <TimeInput name="sessionStart" label="Class starts" value={settings.sessionStart} />
            <TimeInput name="sessionEnd" label="Class ends" value={settings.sessionEnd} />
            <TimeInput name="breakStart" label="Break starts" value={settings.breakStart} />
            <TimeInput name="breakEnd" label="Break ends" value={settings.breakEnd} />
          </div>
          <p className="mt-1 text-xs text-slate-600">
            Time before class starts or after it ends isn't counted, and the break is deducted. Leave the break empty if there is none.
            Changes apply to days filled out from now on.
          </p>
        </fieldset>
        <Submit>Save class settings</Submit>
      </ActionForm>
      {settings.classroomUrl && (
        <ActionForm action={sendLink} confirm={`Email the Google Classroom link to ${studentCount} student${studentCount === 1 ? "" : "s"}?`} className="border-t border-line pt-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-slate-600">{settings.classroomSentAt ? `Last emailed ${settings.classroomSentAt}.` : "Not emailed yet. Students also see the link on their dashboard."}</p>
            <Submit variant="secondary">Email the link to students</Submit>
          </div>
        </ActionForm>
      )}
    </div>
  );
}
