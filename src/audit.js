/*
 * The accountant.
 *
 * Every statement is checked three ways, to the paisa (tolerance ₹0):
 *
 *   1. Does it tally?      opening + money in − money out = closing
 *                          (cards: opening + purchases − payments = total due)
 *                          and do the transactions we read add up to the
 *                          totals and counts the bank printed?
 *   2. Does it follow on?  this statement's opening = the previous one's
 *                          closing, with no days missing in between.
 *   3. Does the ledger agree?  every statement line is in the ledger, and every
 *                          ledger entry on that account is on the statement.
 *
 * Nothing here writes anything. These are pure functions over the statement
 * book and the ledger, so the audit always reflects the ledger as it is right
 * now — edit an amount and the month turns red immediately.
 */

export const TOL = 0;                       // Siddharth's call: exact, ₹0
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const differs = (a, b) => Math.abs(r2(a) - r2(b)) > TOL + 0.001;
const sum = (xs, f = (x) => x) => r2(xs.reduce((s, x) => s + (Number(f(x)) || 0), 0));
const addDays = (iso, n) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const monthOf = (iso) => String(iso || "").slice(0, 7);
const monthEnd = (m) => { const [y, mo] = m.split("-").map(Number); return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10); };
export const monthsBetween = (a, b) => {
  const out = []; let [y, m] = a.split("-").map(Number); const [by, bm] = b.split("-").map(Number);
  while (y < by || (y === by && m <= bm)) { out.push(`${y}-${String(m).padStart(2, "0")}`); m++; if (m > 12) { m = 1; y++; } }
  return out;
};

/* ---------------------------------------------------------------------------
 * Statement records
 * ------------------------------------------------------------------------- */

/** One compact line per statement transaction: "date|amount|d or c|balance". */
export const packRow = (t) => [t.date, r2(t.amount).toFixed(2), t.kind === "credit" ? "c" : "d", t.balance == null || isNaN(t.balance) ? "" : r2(t.balance)].join("|");
export const unpackRow = (s) => { const [date, a, k, b] = s.split("|"); return { date, amount: +a, kind: k === "c" ? "credit" : "debit", balance: b === "" || b == null ? null : +b }; };
export const rowKey = (date, amount, kind) => `${date}|${r2(amount).toFixed(2)}|${kind === "credit" || kind === "c" ? "c" : "d"}`;

/**
 * Build the record kept for a statement from what /api/extract returned.
 * Printed figures win; the running balance fills in what wasn't printed.
 */
export function makeStatementRecord({ id, bank, mode, file, via, transactions = [], figures = {}, diagnostics = {}, skipped = [] }) {
  const printed = figures.printed || {};
  const derived = figures.derived || {};
  const dates = transactions.map((t) => t.date).filter(Boolean).sort();
  const pick = (k) => (printed[k] != null ? { v: printed[k], src: "printed" } : derived[k] != null ? { v: derived[k], src: "running balance" } : { v: null, src: null });
  const op = pick("opening"), cl = pick("closing");
  const card = mode === "card";
  // A card with only "total due" read by the older summary reader
  if (card && cl.v == null && figures.amountDue != null) { cl.v = figures.amountDue; cl.src = "printed"; }
  return {
    id, bank, mode: card ? "card" : "savings", file: file || "", via: via || "import",
    at: new Date().toISOString(),
    from: printed.from || dates[0] || null,
    to: printed.to || dates[dates.length - 1] || null,
    periodSrc: printed.from ? "printed" : "transaction dates",
    opening: op.v, openingSrc: op.src,
    closing: cl.v, closingSrc: cl.src,
    // both kept when both exist, so a disagreement between them can be shown
    alt: { opening: derived.opening ?? null, closing: derived.closing ?? null },
    printed: ["debits", "credits", "drCount", "crCount", "payments", "purchases", "charges"]
      .reduce((o, k) => (printed[k] != null ? { ...o, [k]: printed[k] } : o), {}),
    rows: transactions.map(packRow),
    rowCheck: diagnostics.balanceCheck
      ? { ok: !!diagnostics.balanceCheck.ok, breaks: diagnostics.balanceCheck.breakCount ?? diagnostics.balanceCheck.breaks ?? 0, direction: diagnostics.balanceCheck.direction || null }
      : null,
    skipped: skipped.map((s) => ({ key: rowKey(s.date, s.amount, s.kind), date: s.date, amount: r2(s.amount), kind: s.kind, desc: String(s.desc || "").slice(0, 60), reason: s.reason })),
  };
}

/* ---------------------------------------------------------------------------
 * 1. Does the statement tally?
 * ------------------------------------------------------------------------- */

/** Money out and in, as the bank sees it on this account. */
function movement(rows) {
  const dr = sum(rows.filter((r) => r.kind === "debit"), (r) => r.amount);
  const cr = sum(rows.filter((r) => r.kind === "credit"), (r) => r.amount);
  return { dr, cr, drN: rows.filter((r) => r.kind === "debit").length, crN: rows.filter((r) => r.kind === "credit").length };
}
/** Closing balance the transactions imply. A card's balance is what you owe. */
const expectClosing = (mode, opening, m) => r2(mode === "card" ? opening + m.dr - m.cr : opening + m.cr - m.dr);

export function tallyStatement(st) {
  const rows = st.rows.map(unpackRow);
  const m = movement(rows);
  const findings = [];
  const f = (level, code, text, extra = {}) => findings.push({ level, code, text, ...extra });

  if (st.opening == null || st.closing == null) {
    f("unverified", "no-balances", `Couldn't read the ${st.opening == null ? "opening" : "closing"} balance${st.opening == null && st.closing == null ? "s" : ""} from this statement — enter ${st.opening == null && st.closing == null ? "them" : "it"} to verify.`);
  } else {
    const exp = expectClosing(st.mode, st.opening, m);
    if (differs(exp, st.closing)) {
      f("bad", "no-tally", st.mode === "card"
        ? `Doesn't tally: opening ${st.opening} + purchases ${m.dr} − payments ${m.cr} = ${exp}, but the statement says ${st.closing}.`
        : `Doesn't tally: opening ${st.opening} + in ${m.cr} − out ${m.dr} = ${exp}, but closing is ${st.closing}.`,
        { gap: r2(st.closing - exp) });
    }
  }
  // printed figures and running balance should agree with each other too
  for (const k of ["opening", "closing"]) {
    if (st[k + "Src"] === "printed" && st.alt?.[k] != null && differs(st[k], st.alt[k])) {
      f("bad", "printed-vs-running", `The printed ${k} balance (${st[k]}) doesn't match the running balance (${st.alt[k]}).`, { gap: r2(st[k] - st.alt[k]) });
    }
  }
  const p = st.printed || {};
  const outPrinted = st.mode === "card" ? (p.purchases != null ? r2(p.purchases + (p.charges || 0)) : null) : p.debits;
  const inPrinted = st.mode === "card" ? p.payments : p.credits;
  if (outPrinted != null && differs(outPrinted, m.dr)) f("bad", "debits-total", `Money out on the statement is ${outPrinted}; the lines read add up to ${m.dr}.`, { gap: r2(outPrinted - m.dr) });
  if (inPrinted != null && differs(inPrinted, m.cr)) f("bad", "credits-total", `Money in on the statement is ${inPrinted}; the lines read add up to ${m.cr}.`, { gap: r2(inPrinted - m.cr) });
  if (p.drCount != null && p.drCount !== m.drN) f("bad", "debit-count", `The bank counts ${p.drCount} debits; ${m.drN} were read.`);
  if (p.crCount != null && p.crCount !== m.crN) f("bad", "credit-count", `The bank counts ${p.crCount} credits; ${m.crN} were read.`);
  if (st.rowCheck && !st.rowCheck.ok) f("bad", "row-walk", `The running balance breaks on ${st.rowCheck.breaks} line${st.rowCheck.breaks === 1 ? "" : "s"} — a line was misread or is missing.`);
  return { movement: m, findings };
}

/* ---------------------------------------------------------------------------
 * Splitting a statement into calendar months
 * ------------------------------------------------------------------------- */

/**
 * Savings statements can cover a quarter or half-year; the audit grid is
 * monthly. With a running balance, each month's opening is the balance just
 * before its first line, and its closing the balance after its last. A card
 * statement is one billing cycle and is filed under the month it ends in.
 */
export function monthSegments(st) {
  if (!st.from || !st.to) return [];
  const rows = st.rows.map(unpackRow).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (st.mode === "card") {
    return [{ month: monthOf(st.to), from: st.from, to: st.to, opening: st.opening, closing: st.closing, rows, whole: true }];
  }
  // keep the statement's own line order within a day (stable sort above)
  const months = monthsBetween(monthOf(st.from), monthOf(st.to));
  let running = st.opening;
  return months.map((mo, i) => {
    const from = i === 0 ? st.from : `${mo}-01`;
    const to = i === months.length - 1 ? st.to : monthEnd(mo);
    const mine = rows.filter((r) => r.date >= from && r.date <= to);
    const m = movement(mine);
    const opening = running;
    const closing = opening == null ? null : r2(opening + m.cr - m.dr);
    running = closing;
    return { month: mo, from, to, opening, closing, rows: mine, whole: months.length === 1 };
  });
}

/** Balance at the end of `date` according to a statement, or null. */
function balanceAfter(st, date) {
  if (date < st.from || date > st.to || st.opening == null) return null;
  const rows = st.rows.map(unpackRow).filter((r) => r.date <= date);
  const m = movement(rows);
  return expectClosing(st.mode, st.opening, m);
}

/* ---------------------------------------------------------------------------
 * 2. Does each statement follow on from the last?
 * ------------------------------------------------------------------------- */

export function continuity(statements) {
  const out = {};  // statement id -> findings
  const byBank = {};
  statements.forEach((s) => { if (s.from && s.to) (byBank[s.bank] = byBank[s.bank] || []).push(s); });
  for (const list of Object.values(byBank)) {
    list.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : a.to < b.to ? -1 : 1));
    list.forEach((cur, i) => {
      const fs = (out[cur.id] = out[cur.id] || []);
      if (i === 0) { fs.push({ level: "info", code: "first", text: `Starting point for this account: opening balance ${cur.opening ?? "not read"} on ${cur.from}.` }); return; }
      const prev = list[i - 1];
      const gapFrom = addDays(prev.to, 1);
      if (cur.from > gapFrom) {
        fs.push({ level: "bad", code: "missing-days", text: `No statement covers ${gapFrom} to ${addDays(cur.from, -1)} — a statement or pages are missing.` });
      }
      if (cur.opening == null) return;
      // Periods that overlap (a "Jul–Aug" file that starts in June) are
      // compared on the day before this statement starts.
      const prevBal = cur.from <= prev.to ? balanceAfter(prev, addDays(cur.from, -1)) : prev.closing;
      if (prevBal == null) return;
      if (differs(prevBal, cur.opening)) {
        fs.push({ level: "bad", code: "break", text: `Opening balance ${cur.opening} doesn't match the previous statement's ${cur.from <= prev.to ? "balance on " + addDays(cur.from, -1) : "closing balance"} of ${prevBal}.`, gap: r2(cur.opening - prevBal) });
      }
      if (cur.from <= prev.to) {
        fs.push({ level: "info", code: "overlap", text: `Overlaps the previous statement (${cur.from} to ${prev.to}); lines in the overlap are counted once.` });
      }
    });
  }
  return out;
}

/* ---------------------------------------------------------------------------
 * 3. Does the ledger agree with the statement?
 * ------------------------------------------------------------------------- */

/** Ledger rows on an account between two dates, as the statement would show
 *  them. Split entries are put back together — the bank only saw one payment. */
export function ledgerRows({ expenses = [], credits = [] }, bank, from, to) {
  const inRange = (x) => x.bank === bank && x.date >= from && x.date <= to;
  const out = [];
  const splits = {};
  for (const e of expenses) {
    if (!inRange(e) || e.refund) continue;
    if (e.splitOf) { (splits[e.splitOf] = splits[e.splitOf] || { ...e, amount: 0, ids: [] }); splits[e.splitOf].amount = r2(splits[e.splitOf].amount + e.amount); splits[e.splitOf].ids.push(e.id); continue; }
    out.push({ id: e.id, date: e.date, amount: r2(e.amount), kind: "debit", note: e.note || "", src: e.src || "", type: "expense" });
  }
  Object.values(splits).forEach((s) => out.push({ id: s.ids[0], ids: s.ids, date: s.date, amount: s.amount, kind: "debit", note: s.note || "", src: s.src || "", type: "expense", split: true }));
  for (const c of credits) {
    if (!inRange(c)) continue;
    out.push({ id: c.id, date: c.date, amount: r2(c.amount), kind: "credit", note: c.note || "", src: c.src || "", type: "credit" });
  }
  return out;
}

/**
 * Pair statement lines with ledger rows: exact date+amount+direction first,
 * then near misses (same amount within 3 days, or same day with a different
 * amount) so an edited entry is reported as "edited", not "missing + extra".
 */
export function matchLedger(stmtRows, ledger, skipped = []) {
  const pool = ledger.map((l) => ({ ...l, used: false }));
  const missing = [], edited = [];
  const take = (pred) => { const i = pool.findIndex((l) => !l.used && pred(l)); if (i < 0) return null; pool[i].used = true; return pool[i]; };
  const unmatched = [];
  for (const s of stmtRows) {
    const hit = take((l) => l.kind === s.kind && l.date === s.date && !differs(l.amount, s.amount));
    if (!hit) unmatched.push(s);
  }
  const skippedLeft = skipped.map((k) => ({ ...k, used: false }));
  const explained = [];
  for (const s of unmatched) {
    const near = take((l) => l.kind === s.kind && !differs(l.amount, s.amount) && Math.abs(Date.parse(l.date) - Date.parse(s.date)) <= 3 * 864e5);
    if (near) { edited.push({ stmt: s, ledger: near, what: `date ${s.date} → ${near.date}` }); continue; }
    const sk = skippedLeft.find((k) => !k.used && k.key === rowKey(s.date, s.amount, s.kind));
    if (sk) { sk.used = true; explained.push({ stmt: s, reason: sk.reason, desc: sk.desc }); continue; }
    missing.push(s);
  }
  // same day, same direction, different amount → an edited amount
  for (let i = missing.length - 1; i >= 0; i--) {
    const s = missing[i];
    const cands = pool.filter((l) => !l.used && l.kind === s.kind && l.date === s.date);
    if (cands.length === 1) { cands[0].used = true; edited.push({ stmt: s, ledger: cands[0], what: `amount ${s.amount} → ${cands[0].amount}` }); missing.splice(i, 1); }
  }
  const extra = pool.filter((l) => !l.used);
  return { missing, extra, edited, explained };
}

/* ---------------------------------------------------------------------------
 * Everything together: one cell per account per month
 * ------------------------------------------------------------------------- */

const LEVEL = { bad: 3, unverified: 2, explained: 1, info: 0 };
const worst = (fs) => fs.reduce((w, f) => (LEVEL[f.level] > LEVEL[w] ? f.level : w), "info");

/**
 * @param {object[]} statements  the statement book
 * @param {{expenses, credits}} ledger
 * @param {{key,label,mode}[]} banks  accounts that get statements
 * @param {{notes?: Record<string,string>}} opts  accepted findings, by finding id
 * @returns {{ months: string[], cells: Record<bank, Record<month, Cell>>, statements: Record<id, Detail> }}
 */
export function runAudit(statements = [], ledger = {}, banks = [], opts = {}) {
  const notes = opts.notes || {};
  const cont = continuity(statements);
  const detail = {};
  const segFindings = {};   // `${id}|${month}` -> findings from the ledger match

  const byBank = {};
  statements.filter((s) => s.from && s.to).forEach((s) => (byBank[s.bank] = byBank[s.bank] || []).push(s));

  // Ledger match, one account at a time across all its statements, so a line
  // is only ever matched once — overlapping savings statements and card lines
  // dated before the billing period both stay honest.
  for (const [bank, list] of Object.entries(byBank)) {
    list.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
    const lines = [];
    list.forEach((st, i) => {
      const next = list[i + 1];
      // savings: the later statement owns overlapping days
      const cut = st.mode !== "card" && next && next.from <= st.to ? addDays(next.from, -1) : null;
      const segs = monthSegments(st);
      for (const seg of segs) for (const r of seg.rows) {
        if (cut && r.date > cut) continue;
        lines.push({ ...r, st, month: seg.month });
      }
    });
    if (!lines.length) continue;
    const span = [lines.reduce((m, l) => (l.date < m ? l.date : m), list[0].from), list.reduce((m, s) => (s.to > m ? s.to : m), list[0].to)];
    const lrows = ledgerRows(ledger, bank, span[0], span[1]);
    const skipped = list.flatMap((s) => s.skipped || []);
    const lm = matchLedger(lines, lrows, skipped);
    const home = (date) => {
      const st = list.find((s) => date >= s.from && date <= s.to) || list[list.length - 1];
      return { st, month: st.mode === "card" ? monthOf(st.to) : monthOf(date) };
    };
    const push = (st, month, f) => { const k = st.id + "|" + month; (segFindings[k] = segFindings[k] || []).push(f); };
    lm.missing.forEach((s) => push(s.st, s.month, { level: "bad", code: "missing", text: `On the statement but not in the ledger: ${s.date} ${s.kind === "credit" ? "in" : "out"} ${s.amount}.`, gap: s.amount, row: s }));
    lm.edited.forEach((e) => push(e.stmt.st, e.stmt.month, { level: "bad", code: "edited", text: `Changed after import: ${e.ledger.note.slice(0, 40)} — ${e.what}.`, gap: Math.abs(e.stmt.amount - e.ledger.amount), entry: e.ledger, row: e.stmt }));
    lm.explained.forEach((e) => push(e.stmt.st, e.stmt.month, { level: "explained", code: "skipped", text: `Skipped at import (${e.reason}): ${e.stmt.date} ${e.stmt.amount}${e.desc ? " · " + e.desc : ""}.`, row: e.stmt }));
    lm.extra.forEach((l) => { const h = home(l.date); push(h.st, h.month, { level: "bad", code: "extra", text: `In the ledger but not on the statement: ${l.date} ${l.amount} · ${l.note.slice(0, 40)}${l.src === "manual" ? " (added by hand)" : ""}.`, gap: l.amount, entry: l }); });
  }

  const cells = {};
  let minM = null, maxM = null;
  for (const st of statements) {
    const t = tallyStatement(st);
    const stamp = (f, scope) => {
      const id = `${st.bank}:${scope}:${f.code}:${f.row ? rowKey(f.row.date, f.row.amount, f.row.kind) : f.entry ? f.entry.id : ""}`;
      const { st: _drop, ...row } = f.row || {};
      const g = f.row ? { ...f, row } : f;
      return notes[id] ? { ...g, id, level: f.level === "info" ? "info" : "explained", note: notes[id] } : { ...g, id };
    };
    const sf = [...t.findings, ...(cont[st.id] || [])].map((f) => stamp(f, st.from + "~" + st.to));
    const segs = monthSegments(st).map((seg) => {
      const fs = (segFindings[st.id + "|" + seg.month] || []).map((f) => stamp(f, seg.month));
      const { rows, ...rest } = seg;
      return { ...rest, lines: rows.length, ...movement(rows), findings: fs };
    });
    detail[st.id] = { statement: st, movement: t.movement, findings: sf, months: segs };

    for (const sd of segs) {
      const fs = [...sf, ...sd.findings];
      const row = (cells[st.bank] = cells[st.bank] || {});
      const prev = row[sd.month];
      let status = worst(fs); if (status === "info") status = "ok";
      if (prev && rank(prev.status) > rank(status)) status = prev.status;
      const gap = r2((prev?.gap || 0) + fs.filter((f) => f.level === "bad" && f.gap != null).reduce((s, f) => s + Math.abs(f.gap), 0));
      row[sd.month] = {
        month: sd.month, status, gap,
        ids: [...(prev?.ids || []), st.id],
        opening: prev ? prev.opening : sd.opening, closing: sd.closing,
        findings: [...(prev?.findings || []), ...fs.filter((f) => f.level !== "info")],
      };
      if (!minM || sd.month < minM) minM = sd.month;
      if (!maxM || sd.month > maxM) maxM = sd.month;
    }
  }

  const months = minM ? monthsBetween(minM, maxM) : [];
  // a hole in an account's row between two audited months is a missing statement
  for (const b of banks) {
    const row = cells[b.key];
    if (!row) continue;
    const have = months.filter((m) => row[m]);
    for (const m of months) {
      if (!row[m] && m > have[0] && m < have[have.length - 1]) row[m] = { month: m, status: "missing", gap: 0, ids: [], findings: [{ id: `${b.key}:${m}:no-statement:`, level: "bad", code: "no-statement", text: "No statement for this month." }] };
    }
  }
  return { months, cells, statements: detail };
}
const rank = (s) => ({ bad: 4, missing: 4, unverified: 3, explained: 1, ok: 0 }[s] ?? 0);

/** Replace any record for the same account and period; keep the rest. */
export function upsertStatement(book = [], rec) {
  const same = (s) => s.bank === rec.bank && s.from === rec.from && s.to === rec.to;
  return [rec, ...book.filter((s) => !same(s))].sort((a, b) => (a.bank < b.bank ? -1 : a.bank > b.bank ? 1 : a.from < b.from ? -1 : 1));
}
