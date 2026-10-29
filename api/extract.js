import { extractLines, PasswordError } from "./_lib/pdftext.js";
import { parseStatement } from "./_lib/parse.js";
import { requirePasscode } from "./_lib/auth.js";
import { readJsonBody } from "./_lib/blob.js";
import { summarizeStatement } from "./_lib/summary.js";
import { readFigures, balancesFromRows } from "./_lib/figures.js";
import { askClaude } from "./_lib/ai.js";
import { sniff, isSheetKind, parseSpreadsheet, rowsToCSV } from "./_lib/sheet.js";

/*
 * POST /api/extract
 *   { file: <base64 pdf | xlsx | xls | csv>, password?: string, bank?: string, filename?: string }
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

/* Statement passwords saved in Vercel → Settings → Environment Variables,
 * one per account: PDF_PWD_HDFC_BANK, PDF_PWD_HDFC_REGALIA, PDF_PWD_SBI_SID …
 * They stay on the server; they are never returned to the browser or logged. */
function savedPassword(bank) {
  const key = String(bank || "");
  if (!/^[a-z0-9_]{2,32}$/.test(key)) return "";
  return String(process.env["PDF_PWD_" + key.toUpperCase()] || "").trim();
}

const MODE = { hdfc_regalia: "card", hdfc_solitaire: "card" };

/* What the bank says the statement adds up to, plus what the running balance
 * says — the audit compares both against the transactions we read. */
function statementFigures(lineInput, rows, balanceCheck, bank) {
  const mode = MODE[bank] || "savings";
  let printed = {};
  try { printed = readFigures(lineInput, { mode }); } catch { printed = { found: {} }; }
  const derived = balanceCheck ? balancesFromRows(rows, balanceCheck.direction) : {};
  return { mode, printed, derived };
}

const isPasswordError = (e) => e instanceof PasswordError || (e && e.code === "BAD_PASSWORD");

async function withPasswords(candidates, open) {
  let lastErr;
  for (const p of candidates) {
    try { return await open(p); }
    catch (e) { if (!isPasswordError(e)) throw e; lastErr = e; }
  }
  throw lastErr;
}

function passwordMessage(e, hasSaved) {
  return hasSaved
    ? "The password saved in Vercel for this account didn't open the file — check it, or type the password here."
    : (e && e.message) || "This statement is password protected — type its password.";
}

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
      res.status(413).json({ ok: false, error: `That file is ${(bytes.length/1048576).toFixed(1)} MB — too large to process. Split it or export a CSV.` });
      return;
    }
    const kind = sniff(bytes);
    const typed = String(body.password || "");
    const saved = savedPassword(body.bank);
    // Try what was typed first, then the password saved in Vercel for this account.
    const candidates = [...new Set([typed, saved].filter(Boolean))];
    if (!candidates.length) candidates.push("");
    const yearHint = Number(body.yearHint) || new Date().getFullYear();

    if (isSheetKind(kind)) {
      await handleSpreadsheet(res, bytes, candidates, yearHint, t0, kind, !!saved, body.bank);
      return;
    }
    if (kind !== "pdf") {
      res.status(400).json({ ok: false, error: "That file isn't a PDF or an Excel/CSV statement." });
      return;
    }

    let lines = [], pages = 0;
    try {
      const out = await withPasswords(candidates, (p) => extractLines(bytes, p));
      lines = out.lines; pages = out.pages;
    } catch (e) {
      if (isPasswordError(e)) {
        res.status(400).json({ ok: false, error: passwordMessage(e, !!saved), needsPassword: true });
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
      summary: (() => { try { return summarizeStatement(lines.map((l) => l.text)); } catch { return {}; } })(),
      figures: statementFigures(lines, source === "claude" ? [] : parsed.transactions, source === "claude" ? null : parsed.balanceCheck, body.bank),
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String((e && e.message) || e) });
  }
}

/* Excel / CSV statements: decrypt if locked, read the grid, name the columns.
 * Same response shape as the PDF path, so the app treats both identically. */
async function handleSpreadsheet(res, bytes, candidates, yearHint, t0, kind, hasSaved, bank) {
  let parsed;
  try {
    parsed = await withPasswords(candidates, (p) => parseSpreadsheet(bytes, p, { yearHint }));
  } catch (e) {
    if (isPasswordError(e)) {
      res.status(400).json({ ok: false, error: passwordMessage(e, hasSaved), needsPassword: true });
      return;
    }
    throw e;
  }

  let transactions = parsed.transactions.map((t) => ({
    date: t.date,
    description: t.description,
    amount: t.debit || t.credit,
    kind: t.debit ? "debit" : "credit",
    balance: t.balance,
  })).filter((t) => t.amount > 0);

  let source = "spreadsheet";
  let aiError = null;
  if (!transactions.length && parsed.rows.length) {
    try {
      const csv = rowsToCSV(parsed.rows).slice(0, 150000);
      const text = await askClaude({
        maxTokens: 8000,
        content: [{ type: "text", text: AI_PROMPT + "\n\nThe statement, as CSV:\n\n" + csv }],
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
      source = "spreadsheet-empty";
    }
  }

  res.status(200).json({
    ok: true,
    transactions,
    diagnostics: {
      source,
      format: kind,
      encrypted: parsed.encrypted,
      sheet: parsed.sheet,
      rows: parsed.rows.length,
      columns: parsed.columns,
      usedHeader: parsed.usedHeader,
      balanceCheck: parsed.balanceCheck,
      debits: transactions.filter((t) => t.kind === "debit").length,
      credits: transactions.filter((t) => t.kind === "credit").length,
      ms: Date.now() - t0,
      aiError,
    },
    figures: statementFigures(
      parsed.rows.map((r) => (r || []).map((c) => (c && typeof c === "object" ? (c.text ?? c.v ?? "") : (c ?? ""))).join(" ")),
      source === "claude" ? [] : parsed.transactions, source === "claude" ? null : parsed.balanceCheck, bank),
  });
}
