import type { ProgressReport } from "@/db";
import { REPORT_TEMPLATE, monthParts, reportFieldsFor } from "@/lib/reports/template";
import { Card } from "./ui";

/** The Student Progress Report laid out like the paper template. */
export function ReportView({ report, studentName, instructorName }: { report: Pick<ProgressReport, "data" | "month" | "templateVersion" | "signature">; studentName: string; instructorName: string }) {
  const { month, year } = monthParts(report.month);
  const fields = reportFieldsFor(report.templateVersion ?? 1);
  return (
    <Card title={REPORT_TEMPLATE.title}>
      <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        <div><dt className="text-slate-500">Student name</dt><dd className="font-medium">{studentName}</dd></div>
        <div><dt className="text-slate-500">Instructor</dt><dd className="font-medium">{instructorName}</dd></div>
        <div><dt className="text-slate-500">Month</dt><dd className="font-medium">{month}</dd></div>
        <div><dt className="text-slate-500">Year</dt><dd className="font-medium">{year}</dd></div>
        {fields.map((f) => (
          <div key={f.name} className={f.type === "textarea" ? "sm:col-span-2" : ""}>
            <dt className="text-slate-500">{f.label}</dt>
            <dd className="whitespace-pre-wrap font-medium">{String(report.data?.[f.name] ?? "") || "-"}</dd>
          </div>
        ))}
        <div className="sm:col-span-2">
          <dt className="text-slate-500">Instructor Signature</dt>
          <dd>
            {report.signature ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={report.signature.imageDataUrl} alt={`Signature of ${report.signature.signerName}`} className="mt-1 h-14 rounded border border-line bg-white" />
                <span className="text-xs text-slate-500">{report.signature.signerName}, {report.signature.signedAt.toISOString().slice(0, 10)}</span>
              </>
            ) : <span className="font-medium">-</span>}
          </dd>
        </div>
      </dl>
      {(report.templateVersion ?? 1) < 2 && <p className="mt-4 text-xs text-slate-500">Written with the earlier report form (before the official template).</p>}
    </Card>
  );
}
