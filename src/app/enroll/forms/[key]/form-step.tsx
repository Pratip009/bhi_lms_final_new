"use client";

import type { ActionState } from "@/lib/action";
import type { Field as FieldDef } from "@/lib/forms/templates";
import { ActionForm, CheckGroup, Checkbox, Field, RadioGroup, Submit } from "@/components/forms";
import { SignaturePad } from "@/components/signature-pad";

function FieldInput({ f, value }: { f: FieldDef; value: unknown }) {
  switch (f.type) {
    case "heading":
      return <h3 className="border-b border-line pb-1 pt-3 text-base font-semibold">{f.label}</h3>;
    case "note":
      return <p className="whitespace-pre-wrap rounded-md bg-mist p-3 text-sm leading-relaxed">{f.label}</p>;
    case "checkbox":
      return <Checkbox name={f.name} label={f.label} defaultChecked={value === true} required={f.required} />;
    case "radio":
      return <RadioGroup name={f.name} label={f.label} options={f.options ?? []} defaultValue={typeof value === "string" ? value : undefined} required={f.required} />;
    case "multi":
      return <CheckGroup name={f.name} label={f.label} options={f.options ?? []} defaultValue={Array.isArray(value) ? (value as string[]) : []} required={f.required} />;
    case "ssn":
      return <Field name={f.name} label={f.label} type="text" inputMode="numeric" autoComplete="off" placeholder="123-45-6789" required={f.required} maxLength={11}
        help="Only BHI staff can see this number." defaultValue={typeof value === "string" ? value : ""} />;
    default:
      return <Field name={f.name} label={f.label} type={f.type} required={f.required} options={f.options}
        help={f.help} maxLength={f.maxLength} defaultValue={typeof value === "string" ? value : ""} />;
  }
}

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
        {fields.map((f) => <FieldInput key={f.name} f={f} value={values[f.name]} />)}
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
