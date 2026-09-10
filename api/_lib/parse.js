/*
 * Positioned text lines → transactions.
 *
 * Deliberately NOT five per-bank regexes. Indian bank statements all share one
 * shape: a date at the left, a narration, then one to three right-aligned money
 * columns. Which column a number lands in is what makes it a debit, a credit or
 * a running balance.
 *
 * So the money columns are discovered from the data: cluster the x positions of
 * every number on every dated row, then match those clusters left-to-right
 * against the money words in the header row. Order is what identifies them, not
 * proximity — numbers are right-aligned and headers usually are not, so nearest-
 * header matching silently swaps debit and credit.
 *
 * Anything left of the first money column is narration, so reference numbers
 * inside a merchant string ("CHQ PAID 004512") survive intact.
 *
 * Where a balance column exists we re-walk it: balance[i] = balance[i-1] - debit
 * + credit, in whichever direction the statement is ordered — decided once for
 * the whole statement, never per row, or a swapped column would validate itself.
 */

const MONTHS = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,sept:9,oct:10,nov:11,dec:12 };

const DATE_RE = /^(\d{1,2})[/\-. ](\d{1,2}|[A-Za-z]{3,4})[/\-. ](\d{2,4})\b/;

/** "1,24,880.00" | "(1,250.00)" | "742.00Cr" → { value, cr, dr } ; null if not money */
function money(tok) {
  let s = String(tok).trim();
  let cr = false, dr = false;
  if (/^\(.*\)$/.test(s)) { dr = true; s = s.slice(1, -1); }
  const m = s.match(/(cr|dr)\.?$/i);
  if (m) {
    if (m[1].toLowerCase() === "cr") cr = true; else dr = true;
    s = s.slice(0, -m[0].length).trim();
  }
  s = s.replace(/^(?:rs\.?|inr|₹)\s*/i, "").replace(/,/g, "").trim();
  // must look like money: digits with an optional 1-2dp tail.
  if (!/^\d+(?:\.\d{1,2})?$/.test(s)) return null;
  const value = parseFloat(s);
  if (!isFinite(value)) return null;
  return { value, cr, dr, decimals: /\./.test(s) };
}

function parseDate(str, yearHint) {
  const m = String(str).match(DATE_RE);
  if (!m) return null;
  const [, d, mo, y] = m;
  let month;
  if (/^\d+$/.test(mo)) month = parseInt(mo, 10);
  else month = MONTHS[mo.toLowerCase().slice(0, 4)] || MONTHS[mo.toLowerCase().slice(0, 3)];
  if (!month || month < 1 || month > 12) return null;
  let year = parseInt(y, 10);
  if (y.length === 2) year += year > 70 ? 1900 : 2000;
  if (yearHint && Math.abs(year - yearHint) > 25) return null;
  const day = parseInt(d, 10);
  if (day < 1 || day > 31) return null;
  return { iso: `${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`, len: m[0].length };
}

/* ---- tokenising --------------------------------------------------------- */

/** Every money token on a line, each with its own x span. */
function moneyTokens(line) {
  const out = [];
  for (const it of line.items) {
    const whole = it.str.trim();
    const parts = whole.split(/\s+/);
    if (parts.length === 1) {
      const m = money(whole);
      if (m) out.push({ ...m, x: it.x, right: it.x + it.w, str: whole });
      continue;
    }
    const per = it.w / Math.max(1, whole.length);
    let off = 0;
    for (const p of parts) {
      const m = money(p);
      if (m) out.push({ ...m, x: it.x + off * per, right: it.x + (off + p.length) * per, str: p });
      off += p.length + 1;
    }
  }
  return out;
}

const NOISE_RE = /^(opening|closing)\s+balance|^b\/?f\b|^c\/?f\b|^totals?\b|^grand\s+total|^sub\s*total|^statement\s+(period|of|summary|date)|^page\s+\d|^balance\s+(brought|carried)|^(minimum|total)\s+amount\s+due|^credit\s+limit|^available\s+(credit|cash)/i;

const CREDIT_HINT = /\b(payment\s+received|received\s*-?\s*thank|refund(ed)?|reversal|reversed|cashback|by\s+transfer|neft\s*cr|imps\s*cr|upi\/cr|salary|interest\s+credit|dividend|credit\s+adjustment)\b/i;

const HEADER_WORDS = [
  ["debit",   /^(debits?|withdrawals?|dr|paid|withdrawn|debit\s*amount)$/i],
  ["credit",  /^(credits?|deposits?|cr|received|credit\s*amount)$/i],
  ["balance", /^(balance|bal|closing\s*balance|running\s*balance)$/i],
  ["amount",  /^(amount|amt|transaction\s*amount|amount\s*\(inr\)|amount\s*\(rs\.?\)?|amount\s*in\s*inr)$/i],
];

/** Money words in the header row, left to right. */
function headerRoles(lines) {
  let best = null;
  for (const line of lines.slice(0, 60)) {
    const roles = [];
    for (const it of line.items) {
      const s = it.str.trim().replace(/[:.]$/, "");
      for (const [role, re] of HEADER_WORDS) {
        if (re.test(s)) { roles.push({ role, x: it.x, right: it.x + it.w }); break; }
      }
    }
    const kinds = new Set(roles.map((r) => r.role));
    const strong = kinds.has("balance") || (kinds.has("debit") && kinds.has("credit"));
    if (strong || (kinds.size && !best)) {
      const cand = { y: line.y, page: line.page, roles: roles.sort((a, b) => a.x - b.x) };
      if (strong) return cand;
      best = cand;
    }
  }
  return best;
}

/**
 * 1-D clustering of right edges into money columns.
 *
 * Narrations are full of numbers that look like money — "CHQ PAID 004512",
 * "IGST VPS RATE 18.00", a UPI reference. What separates a real money column
 * from those is repetition: a column has tokens sharing a right edge on row
 * after row, while a reference number lands wherever the text happens to end.
 *
 * So: take the columns that appear on most rows as the anchors, then admit
 * sparse ones (a credit column in a month with one refund) only where they sit
 * to the right of the anchors — i.e. in the money area, not in the narration.
 */
function clusterColumns(allTokens, rowCount, tol = 14) {
  const xs = allTokens.map((t) => t.right).sort((a, b) => a - b);
  if (!xs.length) return [];
  const groups = [];
  let cur = [xs[0]];
  for (let i = 1; i < xs.length; i++) {
    if (xs[i] - cur[cur.length - 1] <= tol) cur.push(xs[i]);
    else { groups.push(cur); cur = [xs[i]]; }
  }
  groups.push(cur);
  const all = groups.map((c) => ({
    right: c.reduce((a, b) => a + b, 0) / c.length,
    min: c[0], max: c[c.length - 1], count: c.length,
  }));

  const strong = all.filter((c) => c.count >= Math.max(2, rowCount * 0.6));
  if (!strong.length) return all.filter((c) => c.count >= Math.max(2, rowCount * 0.4));
  const leftBound = Math.min(...strong.map((c) => c.min)) - 6;
  return all.filter((c) => c.min >= leftBound && (strong.includes(c) || c.count >= 1));
}

/* ---- main --------------------------------------------------------------- */

/**
 * @param {{page:number,y:number,text:string,items:{x:number,w:number,str:string}[]}[]} lines
 * @param {{ yearHint?: number }} opts
 */
export function parseStatement(lines, opts = {}) {
  const yearHint = opts.yearHint || new Date().getFullYear();

  // pass 1 — find dated rows and every money token on them
  const dated = [];
  for (const line of lines) {
    if (!line.text || NOISE_RE.test(line.text)) continue;
    const d = parseDate(line.text, yearHint);
    if (!d) continue;
    const toks = moneyTokens(line);
    if (!toks.length) continue;
    // the date itself can tokenise as money on " 04 08 2026" layouts — drop
    // anything sitting inside the matched date span
    const dateEnd = line.items.length ? line.items[0].x + (d.len / Math.max(1, line.items[0].str.length)) * line.items[0].w : 0;
    dated.push({ line, d, toks: toks.filter((t) => t.right > dateEnd + 1) });
  }
  if (!dated.length) {
    return { transactions: [], balanceCheck: null, columns: null, usedHeader: false, reason: "no dated rows with amounts" };
  }

  // pass 2 — discover the money columns, then name them
  const cols = clusterColumns(dated.flatMap((r) => r.toks), dated.length);
  const header = headerRoles(lines);
  const hRoles = header ? header.roles.filter((r) => r.role !== "amount" || header.roles.length === 1) : [];

  let names;
  if (hRoles.length && hRoles.length === cols.length) {
    // same number of money headers as money columns → zip in reading order.
    names = hRoles.map((r) => r.role);
  } else if (cols.length === 3) {
    names = ["debit", "credit", "balance"];
  } else if (cols.length === 2) {
    // debit+credit, or amount+balance. If the rightmost column appears on
    // (almost) every row it is a running balance; a credit column is sparse.
    const rightAlways = cols[1].count >= dated.length * 0.9;
    names = rightAlways ? ["amount", "balance"] : ["debit", "credit"];
  } else if (cols.length === 1) {
    names = ["amount"];
  } else {
    // more columns than we can name — keep the last as balance, first as amount
    names = cols.map((_, i) => (i === 0 ? "amount" : i === cols.length - 1 ? "balance" : "ignore"));
  }
  const columns = cols.map((c, i) => ({ ...c, role: names[i] }));

  const colFor = (tok) => {
    let best = null, bd = Infinity;
    for (const c of columns) {
      const d = Math.abs(tok.right - c.right);
      if (d < bd) { bd = d; best = c; }
    }
    return bd <= 20 ? best : null;
  };

  // Where the money area starts, measured from the LEFT edge of the tokens that
  // actually landed in a column — clustering is on right edges, so a column's
  // own min right edge still sits inside the number and would leave the amount
  // glued to the end of the narration.
  const moneyLefts = dated.flatMap((r) => r.toks.filter((t) => colFor(t)).map((t) => t.x));
  const firstMoneyX = moneyLefts.length ? Math.min(...moneyLefts) - 2 : Infinity;

  // pass 3 — build rows
  const rows = [];
  let last = null;
  for (const line of lines) {
    if (!line.text || NOISE_RE.test(line.text)) { last = null; continue; }
    const hit = dated.find((r) => r.line === line);
    if (!hit) {
      // wrapped narration: text sitting left of the money columns, no date
      if (last && line.items.length && Math.max(...line.items.map((i) => i.x + i.w)) < firstMoneyX) {
        const extra = line.text.trim();
        if (extra && extra.length < 90) last.description += " " + extra;
      }
      continue;
    }

    // narration = everything left of the money columns, minus the leading date
    const narrationItems = line.items.filter((i) => i.x < firstMoneyX);
    let desc = narrationItems.map((i) => i.str).join(" ").replace(/\s+/g, " ").trim();
    desc = desc.replace(DATE_RE, "").replace(/^[\s|:-]+/, "").replace(/[\s.|-]+$/, "").trim();

    let debit = 0, credit = 0, balance = null, amount = null, amountCr = false;
    for (const t of hit.toks) {
      const c = colFor(t);
      const role = c ? c.role : null;
      if (role === "balance") balance = t.value;
      else if (role === "debit") debit = t.value;
      else if (role === "credit") credit = t.value;
      else if (role === "amount") { amount = t.value; amountCr = t.cr; }
      if (t.cr) amountCr = true;
    }

    if (amount !== null && !debit && !credit) {
      if (amountCr || CREDIT_HINT.test(desc)) credit = amount; else debit = amount;
    }
    // an explicit Cr marker always wins over column placement
    if (debit && amountCr) { credit = debit; debit = 0; }

    if (!debit && !credit) { last = null; continue; }

    const row = { date: hit.d.iso, description: desc, debit, credit, balance, page: line.page, raw: line.text };
    rows.push(row);
    last = row;
  }

  return {
    transactions: rows,
    balanceCheck: checkBalances(rows),
    columns: columns.map((c) => ({ role: c.role, right: Math.round(c.right), rows: c.count })),
    usedHeader: !!(hRoles.length && hRoles.length === cols.length),
  };
}

/**
 * Re-walk the running balance. Direction (oldest-first vs newest-first) is
 * decided once from the whole statement — checking each row in whichever
 * direction happens to fit would let a swapped debit/credit column validate
 * itself, which is exactly the error this is here to catch.
 */
export function checkBalances(rows) {
  const b = rows.filter((r) => r.balance !== null);
  if (b.length < 3) return null;

  const score = (dir) => {
    let breaks = [];
    for (let i = 1; i < b.length; i++) {
      const prev = b[i - 1], cur = b[i];
      const expect = dir === "fwd"
        ? prev.balance - cur.debit + cur.credit   // oldest first: this row moves the balance
        : prev.balance + prev.debit - prev.credit; // newest first: the previous row moved it
      if (Math.abs(expect - cur.balance) > 0.02) {
        breaks.push({ date: cur.date, description: cur.description, expected: +expect.toFixed(2), found: cur.balance, raw: cur.raw });
      }
    }
    return breaks;
  };

  const fwd = score("fwd"), rev = score("rev");
  const breaks = fwd.length <= rev.length ? fwd : rev;
  const direction = fwd.length <= rev.length ? "oldest-first" : "newest-first";
  return {
    checked: b.length,
    direction,
    breaks: breaks.slice(0, 25),
    breakCount: breaks.length,
    ok: breaks.length === 0,
  };
}

export const _test = { money, parseDate, headerRoles, clusterColumns };
