import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireStudentStage } from "@/lib/auth";
import { env } from "@/lib/env";
import { paymentSettled } from "@/lib/payment";
import { StudentShell } from "@/components/student-shell";
import { Alert, Card, LinkButton, PageHeader, StatusBadge, fmtDate } from "@/components/ui";
import { EnrollNav } from "../enroll-nav";
import { PaymentReportForm } from "./payment-form";

export const metadata: Metadata = { title: "Tuition payment" };
export const dynamic = "force-dynamic";

/** Private students only. Non-Private students get a 404: this page holds tuition and payment content. */
export default async function PaymentPage() {
  const { user, application } = await requireStudentStage("ENROLL");
  if (application.category !== "PRIVATE") notFound();
  const { PRIVATE_TUITION_USD, PAYMENT_INSTRUCTIONS, PRIVATE_PAYMENT_GATE } = env();
  const settled = paymentSettled(application);
  return (
    <StudentShell name={user.name} step={1} nav={<EnrollNav app={application} active="payment" />}>
      <PageHeader title="Tuition payment" description={<>Status: <StatusBadge status={application.paymentStatus} /></>} />
      <div className="space-y-5">
        {settled ? (
          <Alert tone="success">
            <p className="font-semibold">Your payment is {application.paymentStatus === "WAIVED" ? "waived" : "verified"}.</p>
            <div className="mt-3"><LinkButton href="/enroll/forms/student_data">Continue to the forms</LinkButton></div>
          </Alert>
        ) : (
          <Alert tone="info">
            {PRIVATE_PAYMENT_GATE === "BEFORE_FORMS"
              ? "Private enrollment requires tuition payment first. Once the BHI office verifies your payment, the enrollment forms open."
              : PRIVATE_PAYMENT_GATE === "BEFORE_SUBMIT"
              ? "You can fill in the forms now, but your payment must be verified before you can submit your application."
              : "Your payment must be verified before your application can be approved."}
          </Alert>
        )}
        <Card title="Tuition">
          <p className="text-sm">Program tuition: <strong>{PRIVATE_TUITION_USD > 0 ? `$${PRIVATE_TUITION_USD.toLocaleString("en-US")}` : "as stated in your Private Enrollment Agreement"}</strong></p>
          {PAYMENT_INSTRUCTIONS ? (
            <p className="mt-3 whitespace-pre-wrap rounded-md bg-mist p-4 text-sm">{PAYMENT_INSTRUCTIONS}</p>
          ) : (
            <p className="mt-3 text-sm text-slate-600">Contact the BHI office for payment instructions.</p>
          )}
          <p className="mt-3 text-xs text-slate-500">No card details are collected on this site. The office verifies every payment.</p>
        </Card>
        {!settled && (
          <Card title="I've paid">
            {application.paymentReportedAt && (
              <p className="mb-3 text-sm">You reported a payment on {fmtDate(application.paymentReportedAt)} (reference: {application.paymentReference}). The office will verify it.</p>
            )}
            <PaymentReportForm />
          </Card>
        )}
      </div>
    </StudentShell>
  );
}
