"use client";

import { ActionForm, Field, Submit } from "@/components/forms";
import { acceptInviteAction } from "../../actions";

export function InviteForm({ token }: { token: string }) {
  return (
    <ActionForm action={acceptInviteAction.bind(null, token)} className="mt-6 space-y-4">
      <Field name="password" label="Password" type="password" autoComplete="new-password" required help="At least 10 characters, with a letter and a number" />
      <Field name="confirm" label="Confirm password" type="password" autoComplete="new-password" required />
      <Submit className="w-full">Activate account</Submit>
    </ActionForm>
  );
}