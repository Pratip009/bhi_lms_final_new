import Link from "next/link";
import type { Metadata } from "next";
import { cols } from "@/db";
import { inviteHash, isWellFormedToken } from "@/lib/invite";
import { Alert } from "@/components/ui";
import { InviteForm } from "./invite-form";

export const metadata: Metadata = { title: "Activate your instructor account", referrer: "no-referrer" };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const user = isWellFormedToken(token)
    ? await (await cols()).users.findOne(
        { inviteTokenHash: inviteHash(token), inviteExpiresAt: { $gt: new Date() }, role: "INSTRUCTOR", disabledAt: null },
        { projection: { name: 1, email: 1 } },
      )
    : null;

  if (!user) {
    return (
      <>
        <h1 className="text-2xl font-semibold">This link no longer works</h1>
        <div className="mt-6">
          <Alert tone="warning">
            Invitation links work once and expire after 7 days. Ask the BHI office to send you a new one.
            If you already set your password, sign in instead.
          </Alert>
        </div>
        <p className="mt-6 text-sm"><Link href="/login" className="text-pine-700 underline">Go to sign in</Link></p>
      </>
    );
  }

  return (
    <>
      <h1 className="text-2xl font-semibold">Welcome, {user.name}</h1>
      <p className="mt-1 text-sm text-slate-600">Choose a password for your instructor account ({user.email}). You'll use it to sign in from now on.</p>
      <InviteForm token={token} />
    </>
  );
}