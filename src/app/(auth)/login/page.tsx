import Link from "next/link";
import type { Metadata } from "next";
import { ActionForm, Field, Submit } from "@/components/forms";
import { Alert } from "@/components/ui";
import { loginAction } from "../actions";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ reset?: string }> }) {
  const { reset } = await searchParams;
  return (
    <>
      <h1 className="text-2xl font-semibold">Sign in</h1>
      <p className="mt-1 text-sm text-slate-600">Students, instructors and staff use the same sign-in.</p>
      {reset && <div className="mt-5"><Alert tone="success">Your password was changed. Sign in with the new one.</Alert></div>}
      <ActionForm action={loginAction} className="mt-6 space-y-4">
        <Field name="email" label="Email" type="email" autoComplete="email" required />
        <Field name="password" label="Password" type="password" autoComplete="current-password" required />
        <Submit className="w-full">Sign in</Submit>
      </ActionForm>
      <div className="mt-6 flex flex-wrap justify-between gap-2 text-sm">
        <Link href="/forgot-password" className="text-pine-700 underline">Forgot password?</Link>
        <Link href="/register" className="font-semibold text-pine-700 underline">New student? Create an account</Link>
      </div>
    </>
  );
}
