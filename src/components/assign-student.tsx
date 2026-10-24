"use client";

import { ActionForm, Submit } from "./forms";
import { SelectById } from "./action-widgets";
import { assignStudentAction } from "@/app/admin/actions";

export function AssignStudentToThisClass({ classId, students }: { classId: string; students: { id: string; label: string }[] }) {
  return (
    <ActionForm action={assignStudentAction} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="classId" value={classId} />
      <div className="min-w-[260px] flex-1"><SelectById name="studentId" label="Student" options={students} /></div>
      <label className="flex items-center gap-2 pb-2 text-xs text-slate-600"><input type="checkbox" name="overCapacity" className="accent-pine-700" /> Allow over capacity</label>
      <label className="flex items-center gap-2 pb-2 text-xs text-slate-600"><input type="checkbox" name="fundingMismatch" className="accent-pine-700" /> Allow funding mismatch</label>
      <Submit>Add to class</Submit>
    </ActionForm>
  );
}
