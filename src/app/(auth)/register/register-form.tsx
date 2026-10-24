"use client";

import { ActionForm, Field, Submit } from "@/components/forms";
import { registerAction } from "../actions";

export function RegisterForm({ gmailOnly }: { gmailOnly: boolean }) {
  return (
    <ActionForm action={registerAction} className="mt-6 space-y-4">
      <Field name="name" label="Full name" autoComplete="name" required maxLength={80} />
      <Field
        name="email"
        label={gmailOnly ? "Gmail address" : "Email"}
        type="email"
        autoComplete="email"
        required
        placeholder={gmailOnly ? "you@gmail.com" : undefined}
      />
      <Field name="password" label="Password" type="password" autoComplete="new-password" required help="At least 10 characters, with a letter and a number" />
      <Field name="confirm" label="Confirm password" type="password" autoComplete="new-password" required />
      <Submit className="w-full">Create account</Submit>
    </ActionForm>
  );
}