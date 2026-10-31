import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireStudentStage } from "@/lib/auth";
import { formatUsd } from "@/lib/payment";
import { enrollmentState } from "@/lib/enrollment";
import { describeEnrollment, displayValue, inputFields } from "@/lib/forms/templates";
import { cols } from "@/db";
import { StatusBadge } from "@/components/ui";
import { StudentShell } from "@/components/student-shell";
import { Alert, Card, PageHeader, fmtDate } from "@/components/ui";
import { EnrollNav } from "../enroll-nav";
import { SubmitForm } from "./submit-form";

export const metadata: Metadata = { title: "Review and submit" };
export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  const { user, application } = await requireStudentStage("ENROLL");
  if (!application.category) redirect("/enroll");
  const state = enrollmentState(application);
  const isPrivate = application.category === "PRIVATE";
  const course = application.courseId ? await (await cols()).courses.findOne({ _id: application.courseId }, { projection: { name: 1 } }) : null;

  return (
    <StudentShell name={user.name} step={1} nav={<EnrollNav app={application} active="review" />}>
      <PageHeader title="Review and submit" description={describeEnrollment(application)} />
      <div className="space-y-5">
        <Card title="Course" actions={<Link href="/enroll/course" className="text-sm font-semibold text-pine-700 underline">Change</Link>}>
          <p className="text-sm">{course ? <strong>{course.name}</strong> : <span className="font-semibold text-brick-600">Not chosen</span>}</p>
        </Card>
        {state.forms.map((f) => (
          <Card key={f.template.key} title={f.template.title}
            actions={<Link href={`/enroll/forms/${f.template.key}`} className="text-sm font-semibold text-pine-700 underline">Edit</Link>}>
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              {inputFields(f.template).map((fd) => (
                <div key={fd.name}>
                  <dt className="text-slate-500">{fd.label}</dt>
                  <dd className="whitespace-pre-wrap font-medium">{displayValue(fd, f.data[fd.name]) || "-"}</dd>
                </div>
              ))}
            </dl>
            {f.template.requiresSignature && <p className="mt-4 text-sm">{f.signed ? "Signed ✓" : <span className="font-semibold text-brick-600">Not signed</span>}</p>}
          </Card>
        ))}

        {isPrivate && (
          <Card title="Tuition and fees">
            <p className="text-sm">
              {application.paymentStatus === "PAID" ? <>Paid{application.paymentRequest?.amountPaidCents ? <> <strong>{formatUsd(application.paymentRequest.amountPaidCents)}</strong></> : null}{application.paymentVerifiedAt ? ` on ${fmtDate(application.paymentVerifiedAt)}` : ""}. Thank you.</>
                : application.paymentStatus === "WAIVED" ? "Waived by the BHI office."
                : <span className="font-semibold text-brick-600">Not paid yet. <Link href="/enroll/payment" className="underline">Pay now</Link></span>}
            </p>
          </Card>
        )}

        <Card title="Submit">
          {state.ready ? (
            <SubmitForm resubmit={application.status === "CORRECTIONS_REQUESTED"} />
          ) : (
            <Alert tone="warning">
              <p className="font-semibold">Finish these before submitting:</p>
              <ul className="mt-2 list-disc pl-5">{state.missing.map((m) => <li key={m}>{m}</li>)}</ul>
            </Alert>
          )}
        </Card>
      </div>
    </StudentShell>
  );
}
