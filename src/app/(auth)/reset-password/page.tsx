import Link from "next/link";
import type { Metadata } from "next";
import { ResetForm } from "./reset-form";

export const metadata: Metadata = { title: "Enter your reset code" };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ email?: string }> }) {
  const { email = "" } = await searchParams;
  return (
    <>
      <h1 className="text-2xl font-semibold">Enter your reset code</h1>
      <p className="mt-1 text-sm text-slate-600">If the email is registered, a code is on its way. It expires in 10 minutes.</p>
      <ResetForm email={email.slice(0, 160)} />
      <p className="mt-6 text-sm"><Link href="/forgot-password" className="text-pine-700 underline">Didn't get a code? Request another</Link></p>
    </>
  );
}
