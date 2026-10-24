import Link from "next/link";
import type { Metadata } from "next";
import { env } from "@/lib/env";
import { RegisterForm } from "./register-form";

export const metadata: Metadata = { title: "Create a student account" };

export default function RegisterPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold">Create your student account</h1>
      <p className="mt-1 text-sm text-slate-600">We'll email you a 6-digit code to confirm it's you, then take you to the enrollment forms.</p>
      <RegisterForm gmailOnly={env().REQUIRE_GMAIL} />
      <div className="mt-6 flex flex-wrap justify-between gap-2 text-sm">
        <Link href="/login" className="text-pine-700 underline">Already have an account? Sign in</Link>
        <Link href="/register/instructor" className="text-pine-700 underline">Instructor? Sign up here</Link>
      </div>
    </>
  );
}