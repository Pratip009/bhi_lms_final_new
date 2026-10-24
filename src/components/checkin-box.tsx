"use client";

import type { ActionState } from "@/lib/action";
import { ActionForm, Field, Submit } from "./forms";

export type StudentCheckIn = { open: boolean; checkedIn: { time: string; late: boolean } | null };

/** Student: shown on a class when today's check-in is open, or once they've checked in. */
export function CheckInBox({ state, action }: { state: StudentCheckIn; action: (prev: ActionState, fd: FormData) => Promise<ActionState> }) {
  if (state.checkedIn) {
    return (
      <div role="status" className="rounded-md border border-pine-100 bg-pine-50 px-4 py-3 text-sm text-pine-900">
        <p className="font-semibold">Checked in at {state.checkedIn.time}{state.checkedIn.late ? " (late)" : ""}</p>
        <p className="mt-0.5">Your instructor will confirm your attendance.</p>
      </div>
    );
  }
  if (!state.open) return null;
  return (
    <div className="rounded-md border border-marigold-100 bg-marigold-100/40 px-4 py-3">
      <p className="text-sm font-semibold">Check-in is open</p>
      <p className="mb-2 text-xs text-slate-600">Enter the code on your instructor's screen. It changes every 30 seconds.</p>
      <ActionForm action={action} className="flex flex-wrap items-end gap-2">
        <div className="w-40">
          <Field name="code" label="Code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required />
        </div>
        <Submit>Check in</Submit>
      </ActionForm>
    </div>
  );
}
