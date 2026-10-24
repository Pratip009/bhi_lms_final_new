"use client";

import Link from "next/link";
import { ActionForm, Field, Submit } from "@/components/forms";
import { forgotPasswordAction } from "../actions";

export default function ForgotPasswordPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold">Reset your password</h1>
      <p className="mt-1 text-sm text-slate-600">Enter your account email. If it's registered, we'll send a 6-digit code.</p>
      <ActionForm action={forgotPasswordAction} className="mt-6 space-y-4">
        <Field name="email" label="Email" type="email" autoComplete="email" required />
        <Submit className="w-full">Send code</Submit>
      </ActionForm>
      <p className="mt-6 text-sm"><Link href="/login" className="text-pine-700 underline">Back to sign in</Link></p>
    </>
  );
}
