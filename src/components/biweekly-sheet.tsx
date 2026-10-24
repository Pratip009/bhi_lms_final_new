import Link from "next/link";
import type { BiweeklyTimesheet } from "@/db";
import { EQISS_TEXT } from "@/lib/eqiss-text";
import { COUNTY_LABELS } from "@/lib/forms/templates";
import { biweeklyDueDate } from "@/lib/timesheet";
import { todayLocal } from "@/lib/dates";
import { reopenBiweeklyAction, saveBiweeklyAction, signBiweeklyAction } from "@/lib/actions/sheets";
import { ActionButton } from "./action-widgets";
import { BiweeklyForm } from "./biweekly-form";
import { PrintButton, SignForm } from "./sign-form";
import { Alert, Badge, Card, cx } from "./ui";

const statusBadge = { OPEN: ["Open", "marigold"], CUSTOMER_SIGNED: ["Customer signed", "marigold"], COMPLETED: ["Completed", "pine"] } as const;

function SignatureBlock({ title, sig, current, statement }: { title: string; sig: BiweeklyTimesheet["customerSignature"]; current: boolean; statement: string }) {
  return (
    <div>
      <p className="text-sm font-semibold">{title}</p>
      {statement && <p className="mt-1 whitespace-pre-wrap text-sm">{statement}</p>}
      {sig ? (
        <div className="mt-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={sig.imageDataUrl} alt={`Signature of ${sig.signerName}`} className="h-14 rounded border border-line bg-white" />
          <p className="mt-1 text-xs">{sig.signerName} · Date: {sig.signedAt.toISOString().slice(0, 10)}</p>
          {!current && <p className="text-xs font-semibold text-marigold-700">Entries changed after this signature.</p>}
        </div>
      ) : <p className="mt-2 text-sm text-slate-500">Not signed</p>}
    </div>
  );
}

/** EQISS / One-Stop biweekly ITA report. Same sheet for Hudson, Bergen and Somerset counties. */
export function BiweeklySheet({ sheet, totals, periods, basePath, viewer, studentName }: {
  sheet: BiweeklyTimesheet; totals: { total: number; cumulative: number; customerSignedCurrent: boolean; instructorSignedCurrent: boolean };
  periods: string[]; basePath: string; viewer: { role: "ADMIN" | "INSTRUCTOR" | "STUDENT"; name: string }; studentName: string;
}) {
  const completed = sheet.status === "COMPLETED";
  const mode = completed ? "VIEW" : viewer.role === "STUDENT" ? "CUSTOMER" : "STAFF";
  const due = biweeklyDueDate(sheet.periodStart);
  const overdue = !completed && todayLocal() > due;
  const [label, tone] = statusBadge[sheet.status];
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <nav aria-label="Two-week periods" className="flex flex-wrap gap-1 text-sm">
          {periods.map((p) => (
            <Link key={p} href={`${basePath}?period=${p}`} aria-current={p === sheet.periodStart ? "page" : undefined}
              className={cx("rounded border px-2 py-1 tabular-nums", p === sheet.periodStart ? "border-pine-700 bg-pine-700 text-white" : "border-line bg-white hover:bg-mist")}>{p.slice(5)}</Link>
          ))}
        </nav>
        <PrintButton />
      </div>
      <div>
        <h2 className="text-lg font-semibold">{EQISS_TEXT.title}</h2>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-600">
          <Badge tone={tone}>{label}</Badge>
          {sheet.county && <span>{COUNTY_LABELS[sheet.county]}</span>}
          <span>Due by {due}</span>
          {overdue && <Badge tone="brick">Overdue</Badge>}
        </p>
        <p className="mt-2 text-xs text-slate-500">{EQISS_TEXT.symbols} {EQISS_TEXT.submission}</p>
      </div>
      {completed && viewer.role !== "STUDENT" && <Alert tone="success">Signed by the customer and the instructor. {viewer.role === "ADMIN" ? "Reopen it below to make changes." : "Ask an admin to reopen it to make changes."}</Alert>}

      <BiweeklyForm action={saveBiweeklyAction.bind(null, sheet._id)} header={sheet.header} days={sheet.days} comments={sheet.comments} progress={sheet.progress}
        mode={mode} studentName={studentName} totals={{ total: totals.total, cumulative: totals.cumulative, periodStart: sheet.periodStart, periodEnd: sheet.periodEnd }} />

      <Card title="Certification">
        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-3">
            <SignatureBlock title="Customer / student signature" sig={sheet.customerSignature} current={totals.customerSignedCurrent} statement={EQISS_TEXT.customerCertification} />
            {viewer.role === "STUDENT" && !completed && (!sheet.customerSignature || !totals.customerSignedCurrent) && (
              <div className="print:hidden"><SignForm action={signBiweeklyAction.bind(null, sheet._id)} defaultName={viewer.name} label="Sign as customer" /></div>
            )}
          </div>
          <div className="space-y-3">
            <SignatureBlock title="Instructor signature" sig={sheet.instructorSignature} current={totals.instructorSignedCurrent} statement={EQISS_TEXT.instructorCertification} />
            {viewer.role !== "STUDENT" && !completed && (
              <div className="print:hidden"><SignForm action={signBiweeklyAction.bind(null, sheet._id)} defaultName={viewer.name} label="Sign as instructor" /></div>
            )}
          </div>
        </div>
        {viewer.role === "ADMIN" && completed && (
          <div className="mt-5 border-t border-line pt-4 print:hidden">
            <ActionButton action={reopenBiweeklyAction.bind(null, sheet._id)} label="Reopen report" variant="secondary" confirm="Reopen this report? The instructor's signature is cleared (kept in the audit log)." />
          </div>
        )}
      </Card>
    </div>
  );
}
