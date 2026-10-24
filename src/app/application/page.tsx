import type { Metadata } from "next";
import { cols } from "@/db";
import { requireStudentStage } from "@/lib/auth";
import { StudentShell } from "@/components/student-shell";
import { Alert, Card, PageHeader, StatusBadge, fmtDate } from "@/components/ui";

export const metadata: Metadata = { title: "Application status" };
export const dynamic = "force-dynamic";

export default async function ApplicationStatusPage() {
  const { user, application } = await requireStudentStage("STATUS");
  const step = application.status === "APPROVED" ? 3 : 2;
  // An approved student with no active class is either waiting for a first assignment or has finished/left one.
  const ended = application.status === "APPROVED"
    ? await (await cols()).enrollments.find({ studentId: user._id, status: { $ne: "ACTIVE" } }, { projection: { status: 1, endedAt: 1 } }).sort({ endedAt: -1 }).limit(1).next()
    : null;
  return (
    <StudentShell name={user.name} step={step}>
      <PageHeader title="Your application" description={<>Status: <StatusBadge status={application.status} /></>} />
      <div className="space-y-5">
        {(application.status === "SUBMITTED" || application.status === "RESUBMITTED") && (
          <Alert tone="info">
            <p className="font-semibold">Your application is waiting for approval.</p>
            <p className="mt-1">The admissions team reviews your forms and documents. We'll email you if anything needs to change, and again when you're approved.</p>
          </Alert>
        )}
        {application.status === "APPROVED" && ended && (
          <Alert tone="info">
            <p className="font-semibold">{ended.status === "COMPLETED" ? "You've completed your class." : "You're not currently enrolled in a class."}</p>
            <p className="mt-1">Last class ended {fmtDate(ended.endedAt)}. Contact the office if you expected to be in a class.</p>
          </Alert>
        )}
        {application.status === "APPROVED" && !ended && (
          <Alert tone="success">
            <p className="font-semibold">You're approved.</p>
            <p className="mt-1">The office is placing you in your course section. Your dashboard opens as soon as that's done, and we'll email you.</p>
          </Alert>
        )}
        {application.status === "REJECTED" && (
          <Alert tone="error">
            <p className="font-semibold">Your application wasn't approved.</p>
            {application.rejectionReason && <p className="mt-1 whitespace-pre-wrap">{application.rejectionReason}</p>}
            <p className="mt-2">Contact the office if you have questions.</p>
          </Alert>
        )}
        <Card title="Details">
          <dl className="grid gap-4 text-sm sm:grid-cols-2">
            <div><dt className="text-slate-500">Submitted</dt><dd className="font-medium">{fmtDate(application.submittedAt)}</dd></div>
            <div><dt className="text-slate-500">Email</dt><dd className="font-medium">{user.email}</dd></div>
          </dl>
          <a href={`/api/pdf/application/${application._id}`} className="mt-5 inline-block text-sm font-semibold text-pine-700 underline">Download my application (PDF)</a>
        </Card>
      </div>
    </StudentShell>
  );
}
