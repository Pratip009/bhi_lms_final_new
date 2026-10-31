import "server-only";
import { cols, type Application, type User } from "@/db";
import { inputFields, type FormTemplate, type TemplateContext } from "@/lib/forms/templates";

/** The student's name and chosen course (with fees) that a form's printed text refers to. */
export async function templateContext(app: Pick<Application, "courseId" | "forms">, student: Pick<User, "name"> | null): Promise<TemplateContext> {
  const course = app.courseId ? await (await cols()).courses.findOne({ _id: app.courseId }, { projection: { name: 1, fees: 1 } }) : null;
  const typed = app.forms?.student_data?.data?.legalName;
  return {
    studentName: (typeof typed === "string" && typed.trim()) || student?.name || "",
    course: course ? { name: course.name, fees: course.fees ?? null } : null,
  };
}

/**
 * Answers to show in the form: what was saved, and for empty fields a value from the account or an
 * earlier form (e.g. the address from Student Data), so students don't type the same thing twice.
 */
export function prefillValues(t: FormTemplate, app: Pick<Application, "forms">, user: Pick<User, "name" | "email">): Record<string, unknown> {
  const saved = (app.forms?.[t.key]?.data ?? {}) as Record<string, unknown>;
  if (app.forms?.[t.key]) return saved; // once saved, show exactly what was saved
  const out: Record<string, unknown> = { ...saved };
  for (const f of inputFields(t)) {
    if (!f.prefill) continue;
    let v: unknown;
    if (f.prefill === "name") v = user.name;
    else if (f.prefill === "email") v = user.email;
    else {
      const [form, field] = f.prefill.split(".");
      v = app.forms?.[form]?.data?.[field];
    }
    if (typeof v === "string" && v) out[f.name] = v;
  }
  return out;
}
