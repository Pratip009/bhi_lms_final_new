import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib";

/** Standard PDF fonts only support WinAnsi; replace anything else so generation never crashes. */
export function pdfSafe(s: unknown): string {
  return String(s ?? "")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\r/g, "")
    .replace(/[^\x09\x0A\x20-\x7E\xA0-\xFF]/g, "?");
}

export class PdfWriter {
  doc!: PDFDocument;
  font!: PDFFont;
  bold!: PDFFont;
  page!: PDFPage;
  y = 0;
  readonly margin = 54;
  readonly width = 612;
  readonly height = 792;

  static async create() {
    const w = new PdfWriter();
    w.doc = await PDFDocument.create();
    w.font = await w.doc.embedFont(StandardFonts.Helvetica);
    w.bold = await w.doc.embedFont(StandardFonts.HelveticaBold);
    w.newPage();
    return w;
  }

  newPage() {
    this.page = this.doc.addPage([this.width, this.height]);
    this.y = this.height - this.margin;
  }

  ensure(space: number) {
    if (this.y - space < this.margin) this.newPage();
  }

  wrap(text: string, size: number, font: PDFFont, maxWidth: number): string[] {
    const out: string[] = [];
    for (const para of pdfSafe(text).split("\n")) {
      let line = "";
      for (const word of para.split(/\s+/)) {
        const test = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(test, size) <= maxWidth) line = test;
        else {
          if (line) out.push(line);
          line = word;
          while (font.widthOfTextAtSize(line, size) > maxWidth && line.length > 1) {
            let cut = line.length - 1;
            while (cut > 1 && font.widthOfTextAtSize(line.slice(0, cut), size) > maxWidth) cut--;
            out.push(line.slice(0, cut));
            line = line.slice(cut);
          }
        }
      }
      out.push(line);
    }
    return out;
  }

  text(text: string, opts: { size?: number; bold?: boolean; color?: [number, number, number]; indent?: number; gap?: number } = {}) {
    const size = opts.size ?? 10;
    const font = opts.bold ? this.bold : this.font;
    const x = this.margin + (opts.indent ?? 0);
    const lines = this.wrap(text, size, font, this.width - x - this.margin);
    for (const line of lines) {
      this.ensure(size + 4);
      this.page.drawText(line, { x, y: this.y - size, size, font, color: rgb(...(opts.color ?? [0.1, 0.14, 0.19])) });
      this.y -= size + 4;
    }
    this.y -= opts.gap ?? 2;
  }

  rule() {
    this.ensure(12);
    this.page.drawLine({ start: { x: this.margin, y: this.y - 4 }, end: { x: this.width - this.margin, y: this.y - 4 }, thickness: 0.5, color: rgb(0.8, 0.84, 0.83) });
    this.y -= 14;
  }

  labelValue(label: string, value: string) {
    this.text(label, { size: 8.5, color: [0.4, 0.45, 0.5], gap: 0 });
    this.text(value || "-", { size: 10.5, gap: 6 });
  }

  async image(dataUrlOrBytes: Uint8Array, type: "png" | "jpg", maxW: number, maxH: number) {
    const img = type === "png" ? await this.doc.embedPng(dataUrlOrBytes) : await this.doc.embedJpg(dataUrlOrBytes);
    const scale = Math.min(maxW / img.width, maxH / img.height, 1);
    const w = img.width * scale;
    const h = img.height * scale;
    this.ensure(h + 8);
    this.page.drawImage(img, { x: this.margin, y: this.y - h, width: w, height: h });
    this.y -= h + 8;
  }
}
