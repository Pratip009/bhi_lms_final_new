"use client";

import { ActionForm, Submit, useFormCtx } from "@/components/forms";
import { uploadDocumentAction, deleteDocumentAction } from "../actions";

function FileInput({ type, accept }: { type: string; accept: string }) {
  const { state } = useFormCtx();
  const err = state.fieldErrors?.[`file-${type}`];
  return (
    <div className="flex-1">
      <input type="file" name="file" accept={accept} aria-invalid={!!err} aria-label="Choose a file"
        className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-pine-50 file:px-3 file:py-2 file:font-semibold file:text-pine-800" />
      {err && <p className="mt-1 text-xs font-medium text-brick-600">{err}</p>}
    </div>
  );
}

export function UploadForm({ type, accept }: { type: string; accept: string }) {
  return (
    <ActionForm action={uploadDocumentAction} resetOnSuccess className="mt-3">
      <input type="hidden" name="type" value={type} />
      <div className="flex flex-wrap items-start gap-3">
        <FileInput type={type} accept={accept} />
        <Submit variant="secondary">Upload</Submit>
      </div>
    </ActionForm>
  );
}

export function DeleteDoc({ id }: { id: string }) {
  return (
    <ActionForm action={deleteDocumentAction} confirm="Remove this file?">
      <input type="hidden" name="id" value={id} />
      <button type="submit" className="text-sm font-semibold text-brick-600 underline">Remove</button>
    </ActionForm>
  );
}
