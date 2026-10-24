export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

type Detected = { mime: string; ext: string };

/** Detects type from file content (magic bytes), never from the name or browser-supplied type. */
export function detectFileType(buf: Buffer): Detected | null {
  const startsWith = (sig: number[], offset = 0) => sig.every((b, i) => buf[offset + i] === b);
  if (startsWith([0x25, 0x50, 0x44, 0x46, 0x2d])) return { mime: "application/pdf", ext: "pdf" };
  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mime: "image/png", ext: "png" };
  if (startsWith([0xff, 0xd8, 0xff])) return { mime: "image/jpeg", ext: "jpg" };
  if (startsWith([0x50, 0x4b, 0x03, 0x04])) {
    // ZIP container: accept only if it looks like a Word document.
    const head = buf.subarray(0, Math.min(buf.length, 4000)).toString("latin1");
    if (head.includes("word/") || head.includes("[Content_Types].xml"))
      return { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ext: "docx" };
    return null;
  }
  if (startsWith([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return { mime: "application/msword", ext: "doc" };
  return null;
}

export const ALLOWED_BY_DOC: Record<string, string[]> = {
  RESUME: ["pdf", "docx", "doc"],
  PHOTO_ID: ["pdf", "png", "jpg"],
  SSN_CARD: ["pdf", "png", "jpg"],
  REFERRAL: ["pdf", "png", "jpg", "docx", "doc"],
};

export function safeFileName(name: string) {
  return name.replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "file";
}
