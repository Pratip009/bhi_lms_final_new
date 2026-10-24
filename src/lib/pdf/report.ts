import "server-only";
import { cols } from "@/db";
import { REPORT_TEMPLATE, monthParts, reportFieldsFor } from "@/lib/reports/template";
import { getClassWithCourse } from "@/lib/queries";
import { PdfWriter } from "./text";

export async function buildReportPdf(reportId: string): Promise<Uint8Array> {
  const { progressReports, enrollments, users } = await cols();
  const r = await progressReports.findOne({ _id: reportId });
  if (!r) throw new Error("Report not found");
  const e = await enrollments.findOne({ _id: r.enrollmentId });
  if (!e) throw new Error("Enrollment not found");
  const k = await getClassWithCourse(e.classId);
  const student = await users.findOne({ _id: e.studentId });
  const author = await users.findOne({ _id: r.authorId });
  const row = { r, student: { name: student?.name ?? "" }, c: k?.klass, course: k?.course };

  const w = await PdfWriter.create();
  const { month, year } = monthParts(row.r.month);
  w.text(REPORT_TEMPLATE.title, { size: 16, bold: true, color: [0.12, 0.31, 0.27], gap: 6 });
  w.labelValue("Student name", row.student.name);
  w.labelValue("Instructor", row.r.instructorName ?? author?.name ?? "");
  w.labelValue("Month", month);
  w.labelValue("Year", year);
  w.labelValue("Course", `${row.course?.name ?? ""} (${row.c?.code ?? ""})`);
  w.rule();
  for (const f of reportFieldsFor(row.r.templateVersion ?? 1)) w.labelValue(f.label, String(row.r.data?.[f.name] ?? ""));
  w.rule();
  w.text("Instructor Signature", { size: 11, bold: true, gap: 4 });
  if (row.r.signature) {
    const b64 = row.r.signature.imageDataUrl.split(",")[1] ?? "";
    try {
      await w.image(Buffer.from(b64, "base64"), "png", 200, 60);
    } catch {
      /* unreadable image: name and date below still identify the signer */
    }
    w.labelValue("Signed", `${row.r.signature.signerName}, ${row.r.signature.signedAt.toISOString().slice(0, 10)}`);
  } else {
    w.labelValue("Signed", "Not signed");
  }
  w.labelValue("Status", row.r.status === "SUBMITTED" ? `Submitted ${row.r.submittedAt?.toISOString().slice(0, 10) ?? ""}` : "Draft");
  return w.doc.save();
}
