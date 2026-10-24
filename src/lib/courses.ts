import type { Category, Course } from "@/db/types";

/** A course with no funding programs listed is open to every track. */
export const courseServes = (course: Pick<Course, "fundingPrograms">, category: Category | null | undefined) =>
  !!category && (!course.fundingPrograms?.length || course.fundingPrograms.includes(category));
