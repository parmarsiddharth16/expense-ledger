/*
 * PDF → positioned text lines.
 *
 * Bank statements are laid out as columns, and the column a number sits in is
 * what tells you whether it is a debit, a credit or a running balance. Plain
 * text extraction throws that away, so we keep every fragment's x position and
 * rebuild lines from it.
 *
 * pdfjs-dist opens RC4- and AES-encrypted PDFs natively given the user password,
 * which is why there is no shell-out to qpdf here — that would not survive on
 * Vercel's serverless runtime.
 */

// legacy build: no DOM, no worker, runs in plain Node. Imported statically so
// Vercel's dependency tracing bundles it into the function.
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

export class PasswordError extends Error {
  constructor(msg) { super(msg); this.name = "PasswordError"; this.code = "BAD_PASSWORD"; }
}

/**
 * @param {Buffer|Uint8Array} bytes raw PDF
 * @param {string} password user password, "" if none
 * @returns {Promise<{pages: number, lines: Line[]}>}
 *   Line = { page, y, text, items: [{ x, w, str }] }
 */
export async function extractLines(bytes, password = "") {
  let doc;
  try {
    doc = await pdfjs.getDocument({
      data: new Uint8Array(bytes),
      password: password || undefined,
      useSystemFonts: false,
      isEvalSupported: false,
      disableFontFace: true,
      verbosity: 0,
    }).promise;
  } catch (e) {
    const name = e && (e.name || e.constructor?.name);
    if (name === "PasswordException" || /password/i.test(String(e && e.message))) {
      throw new PasswordError(
        password
          ? "That password didn't open the statement."
          : "This statement is password protected — enter its password."
      );
    }
    throw e;
  }

  const lines = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent({ includeMarkedContent: false });
    /** @type {Map<number, {x:number,w:number,str:string}[]>} */
    const byRow = new Map();
    for (const it of content.items) {
      const str = it.str;
      if (!str || !str.trim()) continue;
      const x = it.transform[4];
      const y = it.transform[5];
      // quantise y so fragments on the same visual row group together even when
      // their baselines differ by a fraction of a point
      const key = Math.round(y / 2) * 2;
      if (!byRow.has(key)) byRow.set(key, []);
      byRow.get(key).push({ x, w: it.width || 0, str });
    }
    const rows = [...byRow.entries()].sort((a, b) => b[0] - a[0]); // top of page first
    for (const [y, items] of rows) {
      items.sort((a, b) => a.x - b.x);
      // join with a space only where there is a real horizontal gap, so
      // "1,24," + "880.00" stays one token but two columns stay apart
      let text = "";
      let prevEnd = null;
      for (const it of items) {
        if (prevEnd !== null && it.x - prevEnd > 1.2) text += " ";
        text += it.str;
        prevEnd = it.x + it.w;
      }
      text = text.replace(/\s+/g, " ").trim();
      if (text) lines.push({ page: p, y, text, items });
    }
    page.cleanup();
  }
  await doc.destroy();
  return { pages: doc.numPages, lines };
}
