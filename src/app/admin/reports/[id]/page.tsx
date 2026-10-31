import Link from "next/link";
import { notFound } from "next/navigation";
import { cols } from "@/db";
import { requireAdmin } from "@/lib/auth";
import { getClassWithCourse } from "@/lib/queries";
import { ActionButton } from "@/components/action-widgets";
import { ReportView } from "@/components/report-view";
import { Badge, PageHeader, fmtDate, fmtDateTime } from "@/components/ui";
import { reopenReportAction } from "../../actions";

export default async function AdminReportPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const { progressReports, enrollments, users } = await cols();
  const r = await progressReports.findOne({ _id: id });
  if (!r) notFound();
  const e = await enrollments.findOne({ _id: r.enrollmentId });
  if (!e) notFound();
  const [student, author, k] = await Promise.all([users.findOne({ _id: e.studentId }), users.findOne({ _id: r.authorId }), getClassWithCourse(e.classId)]);
  return (
    <>
      <Link href={`/admin/students/${e.studentId}`} className="text-sm text-pine-700 underline">{student?.name}</Link>
      <PageHeader
        title={`Progress report, ${r.month}`}
        description={<>{student?.name}, {k?.course.name} ({k?.klass.code}), by {author?.name ?? "-"}. <Badge tone={r.status === "SUBMITTED" ? "pine" : "marigold"}>{r.status === "SUBMITTED" ? `Submitted ${fmtDate(r.submittedAt)}` : "Draft"}</Badge></>}
        actions={
          <>
            <a href={`/api/pdf/report/${r._id}`} className="rounded-md border border-line bg-white px-4 py-2 text-sm font-semibold">Download PDF</a>
            {r.status === "SUBMITTED" && <ActionButton action={reopenReportAction.bind(null, r._id)} label="Reopen for edits" variant="secondary" />}
          </>
        } />
      <ReportView report={r} studentName={student?.name ?? ""} instructorName={r.instructorName ?? author?.name ?? "-"} />
      {(r.revisions?.length ?? 0) > 0 && (
        <details className="mt-6 rounded-lg border border-line bg-white p-5">
          <summary className="cursor-pointer text-sm font-semibold">Earlier versions ({r.revisions!.length})</summary>
          <ol className="mt-4 space-y-4">
            {[...r.revisions!].reverse().map((v, i) => (
              <li key={i} className="border-t border-line pt-3 text-sm">
                <p className="text-slate-500">{fmtDateTime(v.savedAt)} · {v.status === "SUBMITTED" ? "submitted" : "draft"} · {v.instructorName ?? ""}{v.signature ? ` · signed by ${v.signature.signerName}` : ""}</p>
                <pre className="mt-1 whitespace-pre-wrap font-sans">{Object.entries(v.data).map(([k, val]) => `${k}: ${String(val ?? "")}`).join("\n")}</pre>
              </li>
            ))}
          </ol>
        </details>
      )}
    </>
  );
}
