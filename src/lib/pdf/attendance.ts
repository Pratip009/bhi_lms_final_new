import "server-only";
import { rgb } from "pdf-lib";
import { cols } from "@/db";
import { getClassWithCourse, rosterForClass } from "@/lib/queries";
import { PdfWriter, pdfSafe } from "./text";

const MARK: Record<string, string> = { PRESENT: "P", ABSENT: "A", LATE: "L", EXCUSED: "E" };

/**
 * Generic attendance sheet (students x session dates). The official Hudson County and EQISS
 * layouts will be added as separate renderers once their PDFs are received.
 */
export async function buildAttendancePdf(classId: string, from: string, to: string): Promise<Uint8Array> {
  const klass = await getClassWithCourse(classId);
  if (!klass) throw new Error("Class not found");
  const { classSessions } = await cols();
  const sessions = await classSessions.find({ classId, date: { $gte: from, $lte: to } }).sort({ date: 1 }).toArray();
  const roster = (await rosterForClass(classId)).map((r) => ({ enrollmentId: r.enrollment._id, name: r.student.name }));

  const w = await PdfWriter.create();
  w.text("Attendance sheet", { size: 16, bold: true, color: [0.12, 0.31, 0.27], gap: 4 });
  w.text(`${klass.course.name} - ${klass.klass.code} (${klass.klass.cohort})`, { size: 11, bold: true });
  w.text(`Period: ${from} to ${to}    Format: generic`, { size: 9.5, color: [0.4, 0.45, 0.5], gap: 10 });

  const nameW = 150;
  const colsPerPage = 14;
  const colW = (w.width - w.margin * 2 - nameW - 40) / colsPerPage;
  for (let start = 0; start < Math.max(sessions.length, 1); start += colsPerPage) {
    const chunk = sessions.slice(start, start + colsPerPage);
    if (start > 0) w.newPage();
    const row = (cells: string[], bold = false) => {
      w.ensure(16);
      const font = bold ? w.bold : w.font;
      w.page.drawText(pdfSafe(cells[0]).slice(0, 30), { x: w.margin, y: w.y - 10, size: 8.5, font });
      cells.slice(1, -1).forEach((c, i) =>
        w.page.drawText(pdfSafe(c), { x: w.margin + nameW + i * colW, y: w.y - 10, size: 8, font }),
      );
      w.page.drawText(pdfSafe(cells.at(-1) ?? ""), { x: w.width - w.margin - 34, y: w.y - 10, size: 8.5, font });
      w.page.drawLine({ start: { x: w.margin, y: w.y - 14 }, end: { x: w.width - w.margin, y: w.y - 14 }, thickness: 0.3, color: rgb(0.8, 0.84, 0.83) });
      w.y -= 16;
    };
    row(["Student", ...chunk.map((s) => s.date.slice(5)), "Hours"], true);
    for (const r of roster) {
      const marks = chunk.map((s) => MARK[s.records[r.enrollmentId]?.status ?? ""] ?? "");
      const hours = sessions.reduce((sum, s) => sum + (s.records[r.enrollmentId]?.hours ?? 0), 0);
      row([r.name, ...marks, hours.toFixed(1)]);
    }
  }
  w.y -= 8;
  w.text("P = present, A = absent, L = late, E = excused", { size: 8.5, color: [0.4, 0.45, 0.5], gap: 24 });
  w.text("Instructor signature: ____________________________    Date: ______________", { size: 10 });
  return w.doc.save();
}
