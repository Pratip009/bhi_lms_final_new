import { notFound, redirect } from "next/navigation";
import { requireStudentStage } from "@/lib/auth";
import { canEdit, editableSections, enrollmentState, nextStepPath, openCorrection } from "@/lib/enrollment";
import { bodyOf, getTemplate } from "@/lib/forms/templates";
import { prefillValues, templateContext } from "@/lib/forms/context";
import { FormBody } from "@/components/form-body";
import { StudentShell } from "@/components/student-shell";
import { Alert, Card, PageHeader, fmtDate } from "@/components/ui";
import { EnrollNav } from "../../enroll-nav";
import { FormStep } from "./form-step";
import { saveFormAction } from "../../actions";

export const dynamic = "force-dynamic";

export default async function FormPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const { user, application } = await requireStudentStage("ENROLL");
  // getTemplate filters by category, so funded students get a 404 for fee forms.
  const template = getTemplate(key, application.category);
  if (!template) notFound();

  const editable = editableSections(application);
  const correction = application.status === "CORRECTIONS_REQUESTED" ? openCorrection(application) : null;
  const locked = !canEdit(editable, template.key);
  const state = enrollmentState(application);
  const current = state.forms.find((f) => f.template.key === key)!;
  const sig = application.signatures?.[key];
  const ctx = await templateContext(application, user);

  return (
    <StudentShell name={user.name} step={1} nav={<EnrollNav app={application} active={key} />}>
      <PageHeader title={template.title} />
      {correction && !locked && (
        <div className="mb-5"><Alert tone="warning">
          <p className="font-semibold">Please update this form. Note from the admissions team:</p>
          <p className="mt-1 whitespace-pre-wrap">{correction.note}</p>
        </Alert></div>
      )}
      {locked && <div className="mb-5"><Alert tone="info">This section is locked while your application is being corrected. Only the sections listed in the correction email can be changed. <a href={nextStepPath(application)} className="font-semibold underline">Go to the next section to update</a></Alert></div>}
      <Card>
        <FormBody paragraphs={bodyOf(template, ctx)} />
        <FormStep
          action={saveFormAction.bind(null, template.key)}
          fields={template.fields}
          values={prefillValues(template, application, user)}
          locked={locked}
          requiresSignature={template.requiresSignature}
          signature={sig && current.signed ? { name: sig.signerName, signedAt: fmtDate(sig.signedAt) } : null}
          defaultName={user.name}
        />
      </Card>
    </StudentShell>
  );
}
