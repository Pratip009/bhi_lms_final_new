"use client";

import type { ActionState } from "@/lib/action";
import type { ReportField } from "@/lib/reports/template";
import { ActionForm, Field, Submit } from "@/components/forms";
import { SignaturePad } from "@/components/signature-pad";

export function ReportForm({ action, fields, values, header, signed, defaultName }: {
  action: (p: ActionState, fd: FormData) => Promise<ActionState>; fields: ReportField[]; values: Record<string, unknown>;
  header: { studentName: string; instructorName: string; month: string; year: string };
  signed: { name: string; signedAt: string } | null; defaultName: string;
}) {
  return (
    <ActionForm action={action} className="space-y-6">
      <section className="rounded-lg border border-line bg-white p-5">
        <h2 className="mb-4 text-center text-lg font-semibold">Student Progress Report</h2>
        <dl className="mb-5 grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="text-slate-500">Student name</dt><dd className="font-medium">{header.studentName}</dd></div>
          <div><dt className="text-slate-500">Instructor</dt><dd className="font-medium">{header.instructorName}</dd></div>
          <div><dt className="text-slate-500">Month</dt><dd className="font-medium">{header.month}</dd></div>
          <div><dt className="text-slate-500">Year</dt><dd className="font-medium">{header.year}</dd></div>
        </dl>
        <div className="space-y-4">
          {fields.map((f) => (
            <Field key={f.name} name={f.name} label={f.label} type={f.type} options={f.options} required={f.required} maxLength={f.maxLength}
              rows={f.type === "textarea" ? 8 : undefined} defaultValue={typeof values[f.name] === "string" ? (values[f.name] as string) : ""} />
          ))}
        </div>
        <div className="mt-5 border-t border-line pt-5">
          <p className="mb-2 text-sm font-semibold">Instructor Signature</p>
          <SignaturePad existing={signed} defaultName={defaultName} />
        </div>
      </section>
      <div className="flex flex-wrap gap-3">
        <Submit name="intent" value="submit">Sign and submit report</Submit>
        <Submit name="intent" value="draft" variant="secondary">Save draft</Submit>
      </div>
    </ActionForm>
  );
}
