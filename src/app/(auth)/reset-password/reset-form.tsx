"use client";

import { ActionForm, Field, Submit } from "@/components/forms";
import { resetPasswordAction } from "../actions";

export function ResetForm({ email }: { email: string }) {
  return (
    <ActionForm action={resetPasswordAction} className="mt-6 space-y-4">
      <Field name="email" label="Email" type="email" defaultValue={email} required />
      <Field name="code" label="6-digit code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required />
      <Field name="password" label="New password" type="password" autoComplete="new-password" required help="At least 10 characters, with a letter and a number" />
      <Field name="confirm" label="Confirm new password" type="password" autoComplete="new-password" required />
      <Submit className="w-full">Change password</Submit>
    </ActionForm>
  );
}
