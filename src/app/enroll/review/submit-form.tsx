"use client";

import { ActionForm, Checkbox, Submit } from "@/components/forms";
import { submitApplicationAction } from "../actions";

export function SubmitForm({ resubmit }: { resubmit: boolean }) {
  return (
    <ActionForm action={submitApplicationAction} className="space-y-4">
      <Checkbox name="confirm" label="I confirm that everything in my application is accurate and complete." required />
      <Submit>{resubmit ? "Resubmit application" : "Submit application"}</Submit>
    </ActionForm>
  );
}
