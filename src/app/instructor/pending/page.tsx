import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { logoutAction } from "@/app/(auth)/actions";

export const metadata: Metadata = { title: "Waiting for approval" };
export const dynamic = "force-dynamic";

export default async function InstructorPending() {
  const user = await requireUser();
  if (user.role !== "INSTRUCTOR") redirect("/");
  if (user.instructorStatus === "APPROVED") redirect("/instructor");
  const rejected = user.instructorStatus === "REJECTED";
  return (
    <main className="mx-auto max-w-lg px-6 py-24">
      <p className="text-lg font-bold text-pine-700">BHI</p>
      <h1 className="mt-6 text-2xl font-semibold">{rejected ? "Your instructor account wasn't approved" : "Your account is waiting for approval"}</h1>
      <p className="mt-2 text-slate-600">
        {rejected ? "Contact the office if you think this is a mistake." : "An admin reviews instructor sign-ups. We'll email you when you're approved; then you'll see the courses assigned to you."}
      </p>
      <form action={logoutAction} className="mt-8"><button className="text-sm font-semibold text-pine-700 underline">Sign out</button></form>
    </main>
  );
}
