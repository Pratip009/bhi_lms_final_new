import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cols } from "@/db";
import { requireStudentStage } from "@/lib/auth";
import { canEdit, editableSections } from "@/lib/enrollment";
import { SECTION_COURSE, describeEnrollment, feesTotalCents } from "@/lib/forms/templates";
import { formatUsd } from "@/lib/payment";
import { courseServes } from "@/lib/courses";
import { StudentShell } from "@/components/student-shell";
import { Alert, Card, Empty, PageHeader } from "@/components/ui";
import { EnrollNav } from "../enroll-nav";
import { CourseForm } from "./course-form";

export const metadata: Metadata = { title: "Choose your course" };
export const dynamic = "force-dynamic";

export default async function CoursePage() {
  const { user, application } = await requireStudentStage("ENROLL");
  if (!application.category) redirect("/enroll");
  // After paying, the course is fixed (the payment was for it); the office can still change it.
  const paid = application.category === "PRIVATE" && (application.paymentStatus === "PAID" || application.paymentStatus === "WAIVED");
  const locked = !canEdit(editableSections(application), SECTION_COURSE) || paid;
  const all = await (await cols()).courses.find({ archived: false }).sort({ name: 1 }).toArray();
  const offered = all.filter((c) => courseServes(c, application.category));
  return (
    <StudentShell name={user.name} step={1} nav={<EnrollNav app={application} active="course" />}>
      <PageHeader title="Choose your course" description={`Courses offered for ${describeEnrollment(application)}.`} />
      {locked && <div className="mb-5"><Alert tone="info">{paid ? "Your tuition is paid for this course. To change course, contact the BHI office." : "Your course is locked while your application is being corrected."}</Alert></div>}
      <Card>
        {offered.length === 0 ? (
          <Empty>No courses are open for enrollment in your program right now. Please contact the BHI office.</Empty>
        ) : (
          <CourseForm courses={offered.map((c) => ({
            id: c._id, name: c.name, description: c.description,
            // Fees are shown to Private students only; Non-Private students never see tuition or payment information.
            details: [c.hours ? `${c.hours} hours` : "", c.certification ? `Certification: ${c.certification}` : "",
              application.category === "PRIVATE" && c.fees ? `Tuition and fees: ${formatUsd(feesTotalCents(c.fees))}` : ""].filter(Boolean).join(" · "),
          }))} current={application.courseId ?? null} locked={locked} />
        )}
      </Card>
    </StudentShell>
  );
}
