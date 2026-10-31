import "server-only";
import { PDFDocument } from "pdf-lib";
import { cols } from "@/db";
import { getFile } from "@/lib/storage";
import { bodyOf, describeEnrollment, displayValue, documentsFor, templatesFor } from "@/lib/forms/templates";
import { templateContext } from "@/lib/forms/context";
import { PdfWriter } from "./text";
import { answersHash } from "@/lib/enrollment";

/**
 * Builds the enrollment packet. Content comes only from templatesFor(category), which never
 * includes fee templates for funded categories, so a funded packet cannot contain fee content.
 */
export async function buildApplicationPdf(applicationId: string): Promise<Uint8Array> {
  const { applications, users } = await cols();
  const app = await applications.findOne({ _id: applicationId });
  if (!app) throw new Error("Application not found");
  const student = await users.findOne({ _id: app.studentId });
  const docs = app.documents;

  const templates = templatesFor(app.category);
  const ctx = await templateContext(app, student);
  const w = await PdfWriter.create();

  w.text("BHI Enrollment Packet", { size: 18, bold: true, color: [0.12, 0.31, 0.27], gap: 6 });
  w.labelValue("Student", `${student?.name ?? ""} (${student?.email ?? ""})`);
  w.labelValue("Enrollment", describeEnrollment(app));
  const course = app.courseId ? await (await cols()).courses.findOne({ _id: app.courseId }, { projection: { name: 1 } }) : null;
  w.labelValue("Course", course?.name ?? "Not chosen");
  w.labelValue("Status", app.status.replace(/_/g, " "));
  w.labelValue("Submitted", app.submittedAt ? app.submittedAt.toISOString().slice(0, 10) : "Not submitted");
  w.rule();

  for (const t of templates) {
    const resp = app.forms?.[t.key];
    w.text(t.title, { size: 13, bold: true, gap: 4 });
    for (const para of bodyOf(t, ctx)) w.text(para, { size: 9.5, gap: 4 });
    for (const f of t.fields) {
      if (f.type === "heading") { w.text(f.label, { size: 10.5, bold: true, gap: 3 }); continue; }
      if (f.type === "note") { w.text(f.label, { size: 9, gap: 3 }); continue; }
      // The packet is a full record for BHI staff and the student themself, so the SSN is not masked.
      w.labelValue(f.label, displayValue(f, resp?.data?.[f.name], { revealSsn: true }));
    }
    if (t.requiresSignature) {
      const sig = app.signatures?.[t.key];
      if (sig) {
        const b64 = sig.imageDataUrl.split(",")[1] ?? "";
        try {
          await w.image(Buffer.from(b64, "base64"), "png", 200, 60);
        } catch {
          /* unreadable signature image: metadata below still records the signing */
        }
        w.text(`Signed by ${sig.signerName} on ${sig.signedAt.toISOString().replace("T", " ").slice(0, 16)} UTC from IP ${sig.ip}`, { size: 8.5, color: [0.4, 0.45, 0.5], gap: 4 });
        if (resp?.adminEditedAt) w.text(`Answers edited by BHI staff on ${resp.adminEditedAt.toISOString().slice(0, 10)} after signing (recorded in the application history).`, { size: 8.5, color: [0.6, 0.45, 0.1], gap: 4 });
        // The signature covers a hash of the answers; say so plainly if they changed afterwards.
        if (sig.dataHash !== answersHash(t.key, (resp?.data ?? {}) as Record<string, unknown>)) {
          w.text("WARNING: answers changed after signing. This signature does not cover the answers shown.", { size: 9, bold: true, color: [0.66, 0.25, 0.18], gap: 4 });
        }
      } else {
        w.text("Not signed", { size: 9, color: [0.66, 0.25, 0.18] });
      }
    }
    w.rule();
  }

  const allowedDocTypes = new Set(documentsFor(app.category).map((d) => d.type));
  const shownDocs = docs.filter((d) => allowedDocTypes.has(d.type));
  w.text("Uploaded documents", { size: 13, bold: true, gap: 4 });
  for (const d of shownDocs) w.text(`${d.type.replace(/_/g, " ")}: ${d.fileName} (${Math.ceil(d.size / 1024)} KB)`, { size: 10 });
  if (!shownDocs.length) w.text("None", { size: 10 });

  // Append uploaded PDFs and images after the forms.
  for (const d of shownDocs) {
    try {
      const bytes = await getFile(d.storageKey);
      if (d.mimeType === "application/pdf") {
        const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
        const pages = await w.doc.copyPages(src, src.getPageIndices());
        pages.forEach((p) => w.doc.addPage(p));
      } else if (d.mimeType === "image/png" || d.mimeType === "image/jpeg") {
        w.newPage();
        w.text(`${d.type.replace(/_/g, " ")}: ${d.fileName}`, { size: 11, bold: true, gap: 6 });
        await w.image(bytes, d.mimeType === "image/png" ? "png" : "jpg", 504, 640);
      }
    } catch {
      w.newPage();
      w.text(`Could not embed ${d.fileName}; download it separately from the application page.`, { size: 10 });
    }
  }

  return w.doc.save();
}
