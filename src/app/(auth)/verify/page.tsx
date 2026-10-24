import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getSessionUser } from "@/lib/session";
import { homePath } from "@/lib/auth";
import { VerifyForms } from "./verify-forms";
import { logoutAction } from "../actions";

export const metadata: Metadata = { title: "Verify your email" };
export const dynamic = "force-dynamic";

export default async function VerifyPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.emailVerifiedAt) redirect(await homePath(user));
  return (
    <>
      <h1 className="text-2xl font-semibold">Check your email</h1>
      <p className="mt-1 text-sm text-slate-600">
        We sent a 6-digit code to <strong className="text-ink">{user.email}</strong>. It expires in 10 minutes.
      </p>
      <VerifyForms />
      <form action={logoutAction} className="mt-8 border-t border-line pt-4">
        <button className="text-sm text-slate-600 underline">Wrong email? Sign out</button>
      </form>
    </>
  );
}
