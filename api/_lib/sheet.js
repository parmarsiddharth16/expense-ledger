/*
 * Excel / spreadsheet statement → transactions.
 *
 * SBI and Union Bank hand out statements as .xlsx/.xls, often locked with a
 * password. SheetJS (the free build) cannot open an encrypted workbook, so the
 * file is decrypted first with officecrypto-tool — pure JS, so it runs on
 * Vercel's serverless runtime — and only then read.
 *
 * Unlike a PDF, a spreadsheet already tells us which column every value is in,
 * so there is no geometry to recover. The work is finding the header row and
 * naming its columns. If no recognisable header exists, the rows are laid out
 * as synthetic positioned lines and handed to the same column-discovery parser
 * the PDFs use, so the two paths fall back to the same logic.
 *
 * The password is used to open the file and is never stored or logged.
 */

import officeCrypto from "officecrypto-tool";
import XLSX from "xlsx";
import { parseStatement, checkBalances, _test } from "./parse.js";
import { PasswordError, passwordVariants } from "./pdftext.js";

const { money, parseDate } = _test;

/** What kind of bytes these are, from the magic number. */
export function sniff(bytes) {
  const head = bytes.slice(0, 8);
  if (head.slice(0, 5).toString("latin1") === "%PDF-") return "pdf";
  if (head[0] === 0x50 && head[1] === 0x4b) return "xlsx";            // zip (OOXML)
  if (head.toString("hex") === "d0cf11e0a1b11ae1") return "cfb";      // OLE: .xls, or an encrypted .xlsx
  const txt = bytes.slice(0, 512).toString("utf8").toLowerCase();
  if (/<html|<table|<\?xml/.test(txt)) return "html";                // ".xls" that is really HTML/XML
  if (/[,\t;]/.test(txt)) return "text";                             // CSV / TSV
  return "unknown";
}

export function isSheetKind(kind) {
  return kind === "xlsx" || kind === "cfb" || kind === "html" || kind === "text";
}

/** Decrypt if needed. Throws PasswordError on a missing or wrong password. */
export async function openWorkbookBytes(bytes, password = "") {
  let encrypted = false;
  try { encrypted = officeCrypto.isEncrypted(bytes); } catch { encrypted = false; }
  if (!encrypted) return { bytes, encrypted: false };
  if (!password) throw new PasswordError("This spreadsheet is password protected — enter its password.");
  for (const pw of passwordVariants(password)) {
    if (!pw) continue;
    try {
      const out = await officeCrypto.decrypt(bytes, { password: pw });
      return { bytes: Buffer.from(out), encrypted: true };
    } catch (e) {
      if (!/password/i.test(String(e && e.message))) throw e;
    }
  }
  throw new PasswordError("That password didn't open the spreadsheet.");
}

/* ---- reading cells ------------------------------------------------------ */

function pad(n) { return String(n).padStart(2, "0"); }

/** A cell's value as { text, date, num }. Dates stay dates; numbers stay numbers. */
function cellInfo(cell, yearHint) {
  if (!cell || cell.v === undefined || cell.v === null || cell.v === "") return null;
  const text = String(cell.w ?? cell.v).replace(/\s+/g, " ").trim();
  let date = null, num = null;
  if (cell.t === "d" && cell.v instanceof Date) {
    const d = cell.v;
    date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  } else if (cell.t === "n") {
    const fmt = cell.z || "";
    if (fmt && XLSX.SSF.is_date(fmt) && cell.v > 20000 && cell.v < 80000) {
      const p = XLSX.SSF.parse_date_code(cell.v);
      if (p) date = `${p.y}-${pad(p.m)}-${pad(p.d)}`;
    } else {
      num = cell.v;
    }
  }
  if (!date && cell.t === "s") {
    const d = parseDate(text, yearHint);
    if (d) date = d.iso;
  }
  return { text, date, num };
}

function sheetRows(ws, yearHint) {
  if (!ws || !ws["!ref"]) return [];
  const range = XLSX.utils.decode_range(ws["!ref"]);
  const rows = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    const row = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      row.push(cellInfo(ws[XLSX.utils.encode_cell({ r, c })], yearHint));
    }
    if (row.some(Boolean)) rows.push(row);
  }
  return rows;
}

/* ---- header detection --------------------------------------------------- */

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z/ ]+/g, " ").replace(/\s+/g, " ").trim();

const ROLE_TESTS = [
  // order matters: "Withdrawal Amt." is a debit, not an "amount"
  ["balance", (h) => /\bbal(ance)?\b/.test(h)],
  ["drcr",    (h) => /^(dr ?\/ ?cr|cr ?\/ ?dr|debit ?\/ ?credit|credit ?\/ ?debit|type|txn type|transaction type)$/.test(h)],
  ["debit",   (h) => /\b(withdrawals?|debits?|dr|paid out|withdrawn)\b/.test(h)],
  ["credit",  (h) => /\b(deposits?|credits?|cr|paid in|received)\b/.test(h)],
  ["date",    (h) => /\bdate\b/.test(h) || /^(txn|tran|value) dt$/.test(h)],
  ["desc",    (h) => /\b(narration|description|particulars|details|remarks|transaction details)\b/.test(h)],
  ["amount",  (h) => /\b(amount|amt)\b/.test(h)],
];

/** Find the header row and map each role to a column index. */
function findHeader(rows) {
  let best = null;
  for (let r = 0; r < Math.min(rows.length, 60); r++) {
    const map = {};
    const dateCols = [];
    rows[r].forEach((cell, c) => {
      if (!cell || cell.num !== null || cell.date) return;
      const h = norm(cell.text);
      if (!h || h.length > 40) return;
      for (const [role, test] of ROLE_TESTS) {
        if (!test(h)) continue;
        if (role === "date") dateCols.push({ c, h });
        else if (map[role] === undefined) map[role] = c;
        break;
      }
    });
    if (dateCols.length) {
      // prefer the transaction date over the value date
      const txn = dateCols.find((d) => /\b(txn|tran|transaction|posting)\b/.test(d.h)) || dateCols[0];
      map.date = txn.c;
    }
    const hasMoney = map.debit !== undefined || map.credit !== undefined || map.amount !== undefined;
    if (map.date !== undefined && hasMoney) {
      const score = Object.keys(map).length;
      if (!best || score > best.score) best = { row: r, map, score };
      if (map.debit !== undefined && map.credit !== undefined) break;
    }
  }
  return best;
}

const NOISE_RE = /^(opening|closing)\s+balance|^totals?\b|^grand\s+total|^sub\s*total|^balance\s+(brought|carried)|^b\/?f\b|^c\/?f\b/i;
const CREDIT_HINT = /\b(payment\s+received|refund(ed)?|reversal|reversed|cashback|by\s+transfer|neft\s*cr|imps\s*cr|upi\/cr|salary|interest\s+credit|dividend)\b/i;

function amountOf(cell) {
  if (!cell) return null;
  if (cell.num !== null) return { value: Math.abs(cell.num), neg: cell.num < 0, cr: false, dr: false };
  const m = money(cell.text);
  return m ? { value: m.value, neg: false, cr: m.cr, dr: m.dr } : null;
}

function rowsFromHeader(rows, header) {
  const { map } = header;
  const out = [];
  let last = null;
  const descCols = map.desc !== undefined ? [map.desc] : [];
  for (let r = header.row + 1; r < rows.length; r++) {
    const row = rows[r];
    const dcell = row[map.date];
    const date = dcell && dcell.date;
    const descText = (descCols.length
      ? descCols.map((c) => row[c]?.text || "")
      : row.map((c, i) => (c && c.num === null && !c.date && !Object.values(map).includes(i) ? c.text : ""))
    ).join(" ").replace(/\s+/g, " ").trim();

    if (!date) {
      // wrapped narration on the next row, with no date and no money
      const anyMoney = ["debit", "credit", "amount"].some((k) => map[k] !== undefined && amountOf(row[map[k]]));
      if (last && descText && !anyMoney && descText.length < 120 && !NOISE_RE.test(descText)) last.description += " " + descText;
      else last = null;
      continue;
    }
    if (NOISE_RE.test(descText)) { last = null; continue; }

    let debit = 0, credit = 0;
    const d = map.debit !== undefined ? amountOf(row[map.debit]) : null;
    const c = map.credit !== undefined ? amountOf(row[map.credit]) : null;
    if (d && d.value) debit = d.value;
    if (c && c.value) credit = c.value;
    if (!debit && !credit && map.amount !== undefined) {
      const a = amountOf(row[map.amount]);
      if (a && a.value) {
        const flag = map.drcr !== undefined ? norm(row[map.drcr]?.text) : "";
        const isCr = /^c/.test(flag) || a.cr || (!flag && !a.dr && (a.neg ? false : CREDIT_HINT.test(descText)));
        if (isCr) credit = a.value; else debit = a.value;
      }
    }
    if (!debit && !credit) { last = null; continue; }

    const b = map.balance !== undefined ? amountOf(row[map.balance]) : null;
    const rec = { date, description: descText, debit, credit, balance: b ? b.value : null };
    out.push(rec);
    last = rec;
  }
  return out;
}

/** No header we recognise: lay the grid out as positioned lines for the PDF parser. */
function asPositionedLines(rows) {
  const lines = [];
  rows.forEach((row, y) => {
    const items = [];
    let started = false;
    row.forEach((cell, c) => {
      if (!cell) return;
      // the PDF parser expects each line to start with its date
      if (!started && !cell.date && /^\d{1,4}$/.test(cell.text)) return;
      started = true;
      let str = cell.text;
      if (cell.date) { const [Y, M, D] = cell.date.split("-"); str = `${D}/${M}/${Y}`; }
      else if (cell.num !== null) str = cell.num.toFixed(2);
      items.push({ x: c * 100, w: 90, str });
    });
    if (items.length) lines.push({ page: 1, y: -y, text: items.map((i) => i.str).join(" "), items });
  });
  return lines;
}

/** The grid as plain CSV, for the AI fallback. */
export function rowsToCSV(rows) {
  return rows.map((row) => row.map((c) => {
    if (!c) return "";
    const s = c.date || (c.num !== null ? String(c.num) : c.text);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(",")).join("\n");
}

/**
 * @returns {{ transactions, balanceCheck, columns, usedHeader, sheet, encrypted, rows }}
 */
export async function parseSpreadsheet(bytes, password = "", { yearHint } = {}) {
  yearHint = yearHint || new Date().getFullYear();
  const opened = await openWorkbookBytes(bytes, password);
  let wb;
  try {
    // CSV / HTML exports: keep cells as text so "01/09/2026" is read day-first
    // (Indian banks) by our own date parser, not month-first by SheetJS.
    const k = sniff(opened.bytes);
    const textual = k === "text" || k === "html";
    wb = XLSX.read(opened.bytes, { type: "buffer", cellDates: false, cellNF: true, dense: false, ...(textual ? { raw: true } : {}) });
  } catch (e) {
    if (/password|encrypt/i.test(String(e && e.message))) {
      throw new PasswordError(password ? "That password didn't open the spreadsheet." : "This spreadsheet is password protected — enter its password.");
    }
    throw new Error("That spreadsheet couldn't be read: " + String((e && e.message) || e));
  }

  // the sheet with the most dated rows is the statement
  let pick = null;
  for (const name of wb.SheetNames) {
    const rows = sheetRows(wb.Sheets[name], yearHint);
    const dated = rows.filter((r) => r.some((c) => c && c.date)).length;
    if (!pick || dated > pick.dated) pick = { name, rows, dated };
  }
  const rows = pick ? pick.rows : [];

  const header = findHeader(rows);
  let result;
  if (header) {
    const txns = rowsFromHeader(rows, header);
    const columns = Object.entries(header.map).map(([role, c]) => ({ role, col: XLSX.utils.encode_col(c) }));
    result = { transactions: txns, balanceCheck: checkBalances(txns), columns, usedHeader: true };
  } else {
    result = parseStatement(asPositionedLines(rows), { yearHint });
  }
  return { ...result, sheet: pick ? pick.name : null, encrypted: opened.encrypted, rows };
}
