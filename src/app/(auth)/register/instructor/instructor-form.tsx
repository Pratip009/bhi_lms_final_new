"use client";

import { ActionForm, Field, Submit } from "@/components/forms";
import { registerInstructorAction } from "../../actions";

export function InstructorRegisterForm() {
  return (
    <ActionForm action={registerInstructorAction} className="mt-6 space-y-4">
      <Field name="name" label="Full name" autoComplete="name" required maxLength={80} />
      <Field name="email" label="Email" type="email" autoComplete="email" required />
      <Field name="password" label="Password" type="password" autoComplete="new-password" required help="At least 10 characters, with a letter and a number" />
      <Field name="confirm" label="Confirm password" type="password" autoComplete="new-password" required />
      <Submit className="w-full">Create instructor account</Submit>
    </ActionForm>
  );
}
