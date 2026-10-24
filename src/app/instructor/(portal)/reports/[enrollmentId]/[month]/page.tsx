import Link from "next/link";
import { notFound } from "next/navigation";
import { cols } from "@/db";
import { requireInstructor } from "@/lib/auth";
import { getVisibleEnrollment, ForbiddenError } from "@/lib/authz";
import { REPORT_TEMPLATE, monthParts, monthSchema } from "@/lib/reports/template";
import { getClassWithCourse } from "@/lib/queries";
import { ReportView } from "@/components/report-view";
import { Alert, PageHeader, fmtDate } from "@/components/ui";
import { ReportForm } from "./report-form";
import { saveReportAction } from "@/app/instructor/actions";
import { thisMonthLocal } from "@/lib/dates";

export default async function ReportPage({ params }: { params: Promise<{ enrollmentId: string; month: string }> }) {
  const user = await requireInstructor();
  const { enrollmentId, month } = await params;
  if (!/^[0-9a-f-]{36}$/.test(enrollmentId) || !monthSchema.safeParse(month).success || month > thisMonthLocal()) notFound();
  let enrollment;
  try {
    enrollment = await getVisibleEnrollment(user, enrollmentId);
  } catch (e) {
    if (e instanceof ForbiddenError) notFound();
    throw e;
  }
  const { users, progressReports } = await cols();
  const student = await users.findOne({ _id: enrollment.studentId }, { projection: { name: 1 } });
  const row = await getClassWithCourse(enrollment.classId);
  const report = await progressReports.findOne({ enrollmentId: enrollment._id, month });
  const earlier = await progressReports.find({ enrollmentId: enrollment._id, month: { $ne: month } }, { projection: { month: 1, status: 1 } }).sort({ month: -1 }).toArray();
  const parts = monthParts(month);
  const ownSig = report?.signature && report.signature.signerId === user._id ? { name: report.signature.signerName, signedAt: fmtDate(report.signature.signedAt) } : null;

  return (
    <>
      <Link href={`/instructor/classes/${enrollment.classId}?month=${month}`} className="text-sm text-pine-700 underline">{row?.course.name}: {row?.klass.code}</Link>
      <PageHeader title={`Progress report: ${student?.name}`} description={`${parts.month} ${parts.year}`}
        actions={report && <a href={`/api/pdf/report/${report._id}`} className="rounded-md border border-line bg-white px-4 py-2 text-sm font-semibold">Download PDF</a>} />
      {report?.status === "SUBMITTED" ? (
        <>
          <div className="mb-5"><Alert tone="success">Submitted. Ask an admin to reopen it if something needs to change.</Alert></div>
          <ReportView report={report} studentName={student?.name ?? ""} instructorName={report.instructorName ?? user.name} />
        </>
      ) : (
        <ReportForm action={saveReportAction.bind(null, enrollment._id, month)} fields={REPORT_TEMPLATE.fields} values={report?.templateVersion === 2 ? report.data : {}}
          header={{ studentName: student?.name ?? "", instructorName: user.name, month: parts.month, year: parts.year }} signed={ownSig} defaultName={user.name} />
      )}
      {earlier.length > 0 && (
        <p className="mt-6 text-sm text-slate-600">Earlier reports: {earlier.map((r, i) => (
          <span key={r._id}>{i > 0 && ", "}<Link href={`/instructor/reports/${enrollment._id}/${r.month}`} className="underline">{r.month}</Link>{r.status === "DRAFT" ? " (draft)" : ""}</span>
        ))}</p>
      )}
    </>
  );
}
