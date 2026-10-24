import Link from "next/link";
import { notFound } from "next/navigation";
import { cols } from "@/db";
import { requireAdmin } from "@/lib/auth";
import { env } from "@/lib/env";
import { getTemplate } from "@/lib/forms/templates";
import { Alert, Card, PageHeader } from "@/components/ui";
import { FormStep } from "@/app/enroll/forms/[key]/form-step";
import { adminSaveFormAction } from "@/app/admin/actions";

/** Admin edits a student's form answers. Audited with before/after; the student's signature stays on record. */
export default async function AdminEditForm({ params }: { params: Promise<{ id: string; key: string }> }) {
  await requireAdmin();
  const { id, key } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const app = await (await cols()).applications.findOne({ _id: id });
  if (!app) notFound();
  const template = getTemplate(key, app.category);
  if (!template) notFound();
  const student = await (await cols()).users.findOne({ _id: app.studentId }, { projection: { name: 1 } });
  return (
    <>
      <Link href={`/admin/applications/${id}`} className="text-sm text-pine-700 underline">Back to {student?.name}'s application</Link>
      <PageHeader title={`Edit: ${template.title}`} description="Changes are saved to the student's application and recorded in its history." />
      {app.signatures?.[key] && <div className="mb-5"><Alert tone="warning">The student signed this form. Their signature stays on record, and the form will show that an admin edited it after signing.</Alert></div>}
      <Card>
        {template.intro && <p className="mb-6 rounded-md bg-mist p-4 text-sm">{template.intro({ tuitionUsd: env().PRIVATE_TUITION_USD })}</p>}
        <FormStep action={adminSaveFormAction.bind(null, id, key)} fields={template.fields} values={app.forms?.[key]?.data ?? {}}
          locked={false} requiresSignature={false} signature={null} defaultName="" adminMode />
      </Card>
    </>
  );
}
