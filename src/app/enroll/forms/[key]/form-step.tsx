"use client";

import type { ActionState } from "@/lib/action";
import type { Field as FieldDef } from "@/lib/forms/templates";
import { ActionForm, Checkbox, Field, Submit } from "@/components/forms";
import { SignaturePad } from "@/components/signature-pad";

export function FormStep({
  action, fields, values, locked, requiresSignature, signature, defaultName, adminMode,
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  fields: FieldDef[];
  values: Record<string, unknown>;
  locked: boolean;
  requiresSignature: boolean;
  signature: { name: string; signedAt: string } | null;
  defaultName: string;
  adminMode?: boolean;
}) {
  return (
    <ActionForm action={action} className="space-y-5">
      <fieldset disabled={locked} className="space-y-5">
        {fields.map((f) =>
          f.type === "checkbox" ? (
            <Checkbox key={f.name} name={f.name} label={f.label} defaultChecked={values[f.name] === true} required={f.required} />
          ) : (
            <Field key={f.name} name={f.name} label={f.label} type={f.type} required={f.required} options={f.options}
              help={f.help} maxLength={f.maxLength} defaultValue={typeof values[f.name] === "string" ? (values[f.name] as string) : ""} />
          ),
        )}
        {requiresSignature && !locked && <SignaturePad existing={signature} defaultName={defaultName} />}
      </fieldset>
      {!locked && (
        <div className="flex flex-wrap gap-3 border-t border-line pt-5">
          <Submit name="intent" value="complete">{adminMode ? "Save changes" : "Save and continue"}</Submit>
          {!adminMode && <Submit name="intent" value="draft" variant="secondary">Save draft</Submit>}
        </div>
      )}
    </ActionForm>
  );
}
