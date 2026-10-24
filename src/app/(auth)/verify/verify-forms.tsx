"use client";

import { ActionForm, Field, Submit } from "@/components/forms";
import { verifyEmailAction, resendVerificationAction } from "../actions";

export function VerifyForms() {
  return (
    <>
      <ActionForm action={verifyEmailAction} className="mt-6 space-y-4">
        <Field name="code" label="6-digit code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required placeholder="123456" />
        <Submit className="w-full">Verify email</Submit>
      </ActionForm>
      <ActionForm action={resendVerificationAction} className="mt-4">
        <Submit variant="ghost">Send a new code</Submit>
      </ActionForm>
    </>
  );
}
