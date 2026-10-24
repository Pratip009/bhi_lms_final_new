import zlib from "node:zlib";

/** Returns true if a PDF made by pdf-lib contains `text` (inflates content streams, matches hex-encoded strings). */
export function pdfContains(buf, text) {
  const raw = buf.toString("latin1");
  const parts = [raw];
  const re = /(?<!end)stream\r?\n/g;
  let m;
  while ((m = re.exec(raw))) {
    const start = m.index + m[0].length;
    const end = raw.indexOf("endstream", start);
    if (end < 0) break;
    try { parts.push(zlib.inflateSync(Buffer.from(raw.slice(start, end), "latin1")).toString("latin1")); } catch { /* not flate */ }
    re.lastIndex = end;
  }
  const all = parts.join("\n");
  const hex = Buffer.from(text, "latin1").toString("hex");
  return all.includes(text) || all.toLowerCase().includes(hex);
}
