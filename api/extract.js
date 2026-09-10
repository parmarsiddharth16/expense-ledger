import { extractLines, PasswordError } from "./_lib/pdftext.js";
import { parseStatement } from "./_lib/parse.js";
import { requirePasscode } from "./_lib/auth.js";
import { readJsonBody } from "./_lib/blob.js";
import { askClaude } from "./_lib/ai.js";

/*
 * POST /api/extract
 *   { file: <base64 pdf>, password?: string, bank?: string, filename?: string }
 * ->{ ok, transactions: [{date, description, amount, kind}], diagnostics }
 *
 * Replaces the /api/decrypt endpoint the app calls but which was never
 * deployed, and the client-side Anthropic call that could never have worked
 * (it sent no API key, and would have exposed one if it had).
 *
 * The deterministic path runs first: decrypt, read the text layer, identify the
 * money columns, re-walk the running balance. Claude is asked only when that
 * finds nothing — a scanned statement with no text layer, or a layout the
 * column model can't read. That keeps the common case free, fast and exact, and
 * it means the AI never gets a chance to "improve" a number that was already
 * read correctly.
 *
 * The password is used to open the document and is never stored or logged.
 */

/* Vercel caps a function request body at ~4.5 MB. Base64 inflates a file by a
 * third, so this comfortably takes a statement PDF (typically well under 1 MB)
 * but not a large scanned one; the client checks the size before posting. */
const MAX_BYTES = 3 * 1024 * 1024;

const AI_PROMPT = `Extract EVERY transaction from this bank or credit-card statement.
Return ONLY a JSON array, no prose and no markdown fences. Each element:
{"date":"YYYY-MM-DD","description":"<merchant or narration, verbatim>","amount":<positive number>,"kind":"debit"|"credit"}
kind="debit" means money left the account (a purchase, withdrawal, fee).
kind="credit" means money came in (a refund, reversal, salary, or a payment towards a credit card).
Infer the year from the statement period. Copy descriptions verbatim — do not tidy, translate or expand them.
Exclude opening/closing balances, summary totals, and any "amount due" lines.
If you cannot read it, return [].`;

function salvageJSON(text) {
  if (!text) return [];
  let s = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  const i = s.indexOf("[");
  if (i < 0) return [];
  s = s.slice(i);
  try { return JSON.parse(s); } catch {}
  const last = s.lastIndexOf("}");
  if (last > 0) { try { return JSON.parse(s.slice(0, last + 1) + "]"); } catch {} }
  return [];
}

export default async function handler(req, res) {
  if (!requirePasscode(req, res)) return;
  if (req.method !== "POST") { res.status(405).json({ ok: false, error: "Method not allowed" }); return; }

  const t0 = Date.now();
  try {
    const body = await readJsonBody(req);
    const b64 = String(body.file || "").replace(/^data:[^,]+,/, "");
    if (!b64) { res.status(400).json({ ok: false, error: "No file supplied." }); return; }

    const bytes = Buffer.from(b64, "base64");
    if (!bytes.length) { res.status(400).json({ ok: false, error: "That file didn't decode." }); return; }
    if (bytes.length > MAX_BYTES) {
      res.status(413).json({ ok: false, error: `That PDF is ${(bytes.length/1048576).toFixed(1)} MB — too large to process. Split it or export a CSV.` });
      return;
    }
    if (bytes.slice(0, 5).toString("latin1") !== "%PDF-") {
      res.status(400).json({ ok: false, error: "That doesn't look like a PDF." });
      return;
    }

    const password = String(body.password || "");
    const yearHint = Number(body.yearHint) || new Date().getFullYear();

    let lines = [], pages = 0;
    try {
      const out = await extractLines(bytes, password);
      lines = out.lines; pages = out.pages;
    } catch (e) {
      if (e instanceof PasswordError || e.code === "BAD_PASSWORD") {
        res.status(400).json({ ok: false, error: e.message, needsPassword: true });
        return;
      }
      throw e;
    }

    const parsed = parseStatement(lines, { yearHint });
    let transactions = parsed.transactions.map((t) => ({
      date: t.date,
      description: t.description,
      amount: t.debit || t.credit,
      kind: t.debit ? "debit" : "credit",
      balance: t.balance,
    })).filter((t) => t.amount > 0);

    let source = "text-layer";
    let aiError = null;

    // Fall back to Claude only when the deterministic pass came up empty.
    if (!transactions.length) {
      const hasText = lines.length > 3;
      try {
        const text = await askClaude({
          maxTokens: 8000,
          content: [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: bytes.toString("base64") } },
            { type: "text", text: AI_PROMPT },
          ],
        });
        transactions = salvageJSON(text)
          .filter((t) => t && Number(t.amount) > 0 && t.date)
          .map((t) => ({
            date: String(t.date).slice(0, 10),
            description: String(t.description || "").trim(),
            amount: Math.abs(Number(t.amount)),
            kind: t.kind === "credit" ? "credit" : "debit",
            balance: null,
          }));
        source = "claude";
      } catch (e) {
        aiError = String(e.message || e);
        source = hasText ? "text-layer-empty" : "no-text-layer";
      }
    }

    res.status(200).json({
      ok: true,
      transactions,
      diagnostics: {
        source,
        pages,
        textLines: lines.length,
        columns: parsed.columns,
        usedHeader: parsed.usedHeader,
        balanceCheck: parsed.balanceCheck,
        debits: transactions.filter((t) => t.kind === "debit").length,
        credits: transactions.filter((t) => t.kind === "credit").length,
        ms: Date.now() - t0,
        aiError,
      },
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String((e && e.message) || e) });
  }
}
