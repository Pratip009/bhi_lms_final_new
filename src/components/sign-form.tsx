"use client";

import type { ActionState } from "@/lib/action";
import { ActionForm, Submit } from "./forms";
import { SignaturePad } from "./signature-pad";

/** A signature pad plus typed name, posting to a sign action. */
export function SignForm({ action, defaultName, label, statement }: {
  action: (p: ActionState, fd: FormData) => Promise<ActionState>; defaultName: string; label: string; statement?: string;
}) {
  return (
    <ActionForm action={action} className="space-y-4">
      {statement && <p className="whitespace-pre-wrap rounded-md bg-mist p-3 text-sm">{statement}</p>}
      <SignaturePad defaultName={defaultName} />
      <Submit>{label}</Submit>
    </ActionForm>
  );
}

export function PrintButton() {
  return <button type="button" onClick={() => window.print()} className="rounded-md border border-line bg-white px-4 py-2 text-sm font-semibold print:hidden">Print</button>;
}
