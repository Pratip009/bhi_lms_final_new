"use client";

import type { ActionState } from "@/lib/action";
import { ActionForm, Submit } from "./forms";
import { SelectById } from "./action-widgets";

export function AdminCourseForm({ action, courses, current }: { action: (p: ActionState, fd: FormData) => Promise<ActionState>; courses: { id: string; label: string }[]; current: string | null }) {
  return (
    <ActionForm action={action} className="space-y-3">
      <SelectById name="courseId" label="Course" options={courses} defaultValue={current ?? ""} />
      <Submit variant="secondary">Save course</Submit>
    </ActionForm>
  );
}

export function CourseInstructorForm({ action, instructors }: { action: (p: ActionState, fd: FormData) => Promise<ActionState>; instructors: { id: string; label: string }[] }) {
  return (
    <ActionForm action={action} className="flex flex-wrap items-end gap-3">
      <div className="min-w-[260px] flex-1"><SelectById name="instructorId" label="Assign an instructor" options={instructors} /></div>
      <Submit>Assign to course</Submit>
    </ActionForm>
  );
}
