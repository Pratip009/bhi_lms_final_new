"use client";

import { ActionForm, Submit, useFormCtx } from "@/components/forms";
import { setCourseAction } from "../actions";

function Options({ courses, current, locked }: { courses: { id: string; name: string; description: string; details?: string }[]; current: string | null; locked: boolean }) {
  const { state } = useFormCtx();
  return (
    <fieldset disabled={locked}>
      <legend className="sr-only">Course</legend>
      <div className="grid gap-3 md:grid-cols-2">
        {courses.map((c) => (
          <label key={c.id} className="flex cursor-pointer flex-col gap-1 rounded-lg border border-line bg-white p-4 has-[:checked]:border-pine-700 has-[:checked]:ring-2 has-[:checked]:ring-pine-100">
            <span className="flex items-center gap-2 font-semibold">
              <input type="radio" name="courseId" value={c.id} defaultChecked={current === c.id} className="accent-pine-700" />
              {c.name}
            </span>
            {c.details && <span className="text-sm text-slate-700">{c.details}</span>}
            {c.description && <span className="text-sm text-slate-600">{c.description}</span>}
          </label>
        ))}
      </div>
      {state.fieldErrors?.courseId && <p className="mt-2 text-xs font-medium text-brick-600">{state.fieldErrors.courseId}</p>}
    </fieldset>
  );
}

export function CourseForm({ courses, current, locked }: { courses: { id: string; name: string; description: string; details?: string }[]; current: string | null; locked: boolean }) {
  return (
    <ActionForm action={setCourseAction} className="space-y-5">
      <Options courses={courses} current={current} locked={locked} />
      {!locked && <Submit>Save and continue</Submit>}
    </ActionForm>
  );
}
