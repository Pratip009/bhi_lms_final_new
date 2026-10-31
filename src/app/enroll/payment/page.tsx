import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { cols } from "@/db";
import { requireStudentStage } from "@/lib/auth";
import { formatUsd, paymentSettled } from "@/lib/payment";
import { amountDueCents, stripeEnabled } from "@/lib/tuition";
import { startCheckoutAction } from "@/lib/actions/payment";
import { StudentShell } from "@/components/student-shell";
import { ActionButton } from "@/components/action-widgets";
import { Alert, Card, PageHeader } from "@/components/ui";
import { EnrollNav } from "../enroll-nav";

export const metadata: Metadata = { title: "Tuition payment" };
export const dynamic = "force-dynamic";

/**
 * Private students only: pay the chosen course's tuition and fees online before the enrollment forms
 * open. Non-Private students never reach this page (and never see any fee information).
 */
export default async function PaymentPage({ searchParams }: { searchParams: Promise<{ payment?: string }> }) {
  const { user, application } = await requireStudentStage("ENROLL");
  if (application.category !== "PRIVATE") redirect("/enroll");
  if (!application.courseId) redirect("/enroll/course");
  if (paymentSettled(application)) redirect("/enroll");
  const course = await (await cols()).courses.findOne({ _id: application.courseId });
  const due = await amountDueCents(application);
  const cancelled = (await searchParams).payment === "cancelled";
  const f = course?.fees;
  const rows: [string, number][] = f
    ? ([["Tuition", f.tuitionCents], ["Fees", f.feesCents], ["Books", f.booksCents], ["Tools", f.toolsCents], ["Other", f.otherCents]] as [string, number][]).filter(([, c]) => c > 0)
    : [];

  return (
    <StudentShell name={user.name} step={1} nav={<EnrollNav app={application} active="payment" />}>
      <PageHeader title="Tuition payment" description="Private enrollment is paid before the enrollment forms. Your forms open as soon as the payment goes through." />
      {cancelled && <div className="mb-5"><Alert tone="warning">You left the payment page before paying. You can try again any time.</Alert></div>}
      <Card title={course?.name ?? "Your course"}>
        {rows.length > 0 && (
          <table className="mb-4 w-full max-w-sm text-sm">
            <tbody>
              {rows.map(([label, c]) => <tr key={label}><td className="py-1 text-slate-600">{label}</td><td className="py-1 text-right tabular-nums">{formatUsd(c)}</td></tr>)}
            </tbody>
          </table>
        )}
        {due && due.cents >= 50 ? (
          <>
            <p className="text-3xl font-bold tabular-nums">{formatUsd(due.cents)}</p>
            <div className="mt-5">
              {stripeEnabled()
                ? <ActionButton action={startCheckoutAction} label={`Pay ${formatUsd(due.cents)} securely`} />
                : <Alert tone="warning">Online payment isn&apos;t available right now. Please contact the BHI office; they can record a payment made in person.</Alert>}
            </div>
            <p className="mt-3 text-xs text-slate-500">You pay on Stripe&apos;s secure page (card, Apple Pay or Google Pay). Your card details never reach BHI.</p>
          </>
        ) : (
          <Alert tone="warning">The tuition for this course hasn&apos;t been set yet. Please contact the BHI office.</Alert>
        )}
        <p className="mt-5 text-sm"><Link href="/enroll/course" className="text-pine-700 underline">Choose a different course</Link></p>
      </Card>
    </StudentShell>
  );
}
