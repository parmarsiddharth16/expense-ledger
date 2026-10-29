/*
 * Statement figures for the audit: opening balance, closing balance, printed
 * totals and the statement period.
 *
 * The transaction parser deliberately throws these lines away (they aren't
 * transactions). The audit needs them back, because the whole point is to
 * check the transactions we read against what the bank says they add up to.
 *
 * Banks print these three ways, and all three are handled:
 *   1. "Opening Balance : 12,345.00"                       label, value, same line
 *   2. "Opening Balance  Dr Count  Cr Count  Debits ..."   a row of labels,
 *      "12,345.00        20        5         40,000.00"   values on the next line
 *   3. "01/09/2026 Opening Balance   12,345.00"            a row inside the table
 *
 * Anything not found is left out. Nothing here is guessed: a figure we can't
 * read makes the statement "unverified" in the audit, never green.
 */

const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
/* Numeric dates need matching separators ("01/04/2026", "01-04-26"); only a
 * month name may be followed by a comma ("21 Aug, 2026"). Otherwise a run of
 * figures like "69 10 2,86,268.92" reads as a date and eats an amount. */
const DATE_G = /(\d{1,2})(?:([\/\-.])(\d{1,2})\2(\d{4}|\d{2})|[\/\-. ]((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]{0,6})[\/\-., ]+(\d{4}|\d{2}))(?![\d,])/gi;
const dateISO = (m) => toISO(m[1], m[3] || m[5], m[4] || m[6]);

function toISO(d, mo, y) {
  d = +d; mo = /^\d+$/.test(mo) ? +mo : MON[String(mo).slice(0, 3).toLowerCase()]; y = +y;
  if (y < 100) y += 2000;
  if (!d || !mo || mo > 12 || d > 31 || y < 2000 || y > 2100) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
function datesIn(text) {
  const out = [];
  for (const m of String(text).matchAll(DATE_G)) { const iso = dateISO(m); if (iso) out.push({ iso, at: m.index, len: m[0].length }); }
  return out;
}
/** Blank out dates so their digits aren't read as amounts. */
const stripDates = (t) => String(t).replace(DATE_G, (s, ...g) => (dateISO([s, ...g]) ? " ".repeat(s.length) : s));

/* Numbers on a line, in order, with their position. Money (has decimals or
 * grouping commas) and plain integers (Dr/Cr counts) are both kept; callers
 * pick what they need. A trailing Cr/Dr marks the sign. */
const NUM_G = /(?:₹|rs\.?\s*|inr\s*)?(-?\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?|-?\d+\.\d{1,2}|-?\d+)(\s*(?:cr|dr)\b\.?)?/gi;
function numbersIn(text) {
  const out = [];
  for (const m of stripDates(text).matchAll(NUM_G)) {
    const raw = m[1];
    const v = parseFloat(raw.replace(/,/g, ""));
    if (!isFinite(v)) continue;
    const money = /[.,]/.test(raw);
    // a bare 6+ digit integer is an account / reference number, not a figure
    if (!money && raw.replace(/\D/g, "").length >= 6) continue;
    out.push({ v, money, cr: /cr/i.test(m[2] || ""), dr: /dr/i.test(m[2] || ""), at: m.index, end: m.index + m[0].length });
  }
  return out;
}

/* The figures, each with every label banks use for it. Order matters only for
 * overlapping words: longer, more specific labels first. */
const FIELDS = [
  ["opening",   /previous\s+(?:statement\s+)?(?:dues|balance)|opening\s+bal(?:ance)?|(?:balance\s+)?(?:b\/f|brought\s+forward)(?:\s+balance)?|balance\s+as\s+on\s+(?=\d)|op(?:ening)?\.?\s+bal\.?/i],
  ["closing",   /closing\s+bal(?:ance)?|balance\s+(?:c\/f|carried\s+forward)|total\s+(?:amount\s+)?dues?|total\s+amount\s+due|cl(?:osing)?\.?\s+bal\.?/i],
  ["payments",  /payments?\s*\/\s*credits?(?:\s+received)?|payments?\s+(?:&|and)\s+(?:other\s+)?credits?|credits?\s*\/\s*payments?/i],
  ["purchases", /purchases?\s*\/\s*debits?|purchases?\s*(?:&|and)\s*(?:other\s+)?(?:debits?|charges)/i],
  ["charges",   /finance\s+charges?/i],
  ["drCount",   /total\s+debit\s+count|\bdr\.?\s+count|no\.?\s+of\s+debits?|debit\s+count/i],
  ["crCount",   /total\s+credit\s+count|\bcr\.?\s+count|no\.?\s+of\s+credits?|credit\s+count/i],
  // "Total" is required: a bare "Debits / Credits" is usually the table header
  ["debits",    /total\s+debit\s+amount|total\s+debits?|total\s+withdrawals?/i],
  ["credits",   /total\s+credit\s+amount|total\s+credits?|total\s+deposits?/i],
  // bare "Debits" / "Credits": only trusted in a summary box (positional mode)
  ["debits",    /\bdebits\b/i, "weak"],
  ["credits",   /\bcredits\b/i, "weak"],
];
const COUNT_FIELDS = new Set(["drCount", "crCount"]);

/** Every field label on a line, left to right, without overlaps. */
function labelsIn(text, { weak = false } = {}) {
  const hits = [];
  for (const [name, re, kind] of FIELDS) {
    if (kind === "weak" && !weak) continue;
    const g = new RegExp(re.source, "gi");
    for (const m of text.matchAll(g)) hits.push({ name, at: m.index, end: m.index + m[0].length, weak: kind === "weak" });
  }
  hits.sort((a, b) => a.at - b.at || (b.end - b.at) - (a.end - a.at));
  const out = [];
  for (const h of hits) if (!out.some((o) => h.at < o.end && h.end > o.at)) out.push(h);
  return out;
}

const signed = (n, mode) => {
  // On a card, "Cr" after a balance means the bank owes you (a credit balance).
  // On a savings account "Dr" means overdrawn. Either way it flips the sign.
  if (mode === "card") return n.cr ? -n.v : n.v;
  return n.dr ? -n.v : n.v;
};

/**
 * @param {string[]} lineTexts  every text line of the statement, top to bottom
 * @param {{mode?: "card"|"savings"}} opts
 * @returns {{opening?, closing?, debits?, credits?, payments?, purchases?, charges?,
 *            drCount?, crCount?, from?, to?, found: Record<string,string>}}
 */
export function readFigures(lineInput = [], { mode = "savings" } = {}) {
  const L = lineInput.map((t) => String((t && typeof t === "object" ? t.text : t) || "").replace(/\s+/g, " ").trim());
  const out = { found: {} };
  const put = (name, value, how) => {
    if (value == null || !isFinite(value) || name in out) return;  // first sighting wins
    out[name] = Math.round(value * 100) / 100;
    out.found[name] = how;
  };

  // (E) HDFC card summary box: "prev dues − payments + purchases + finance
  // charges = total due". Read first — it is unambiguous, and its header is
  // split over several lines so the label readers below can't pair it.
  // The bank rounds Total Amount Due to the rupee; the exact closing (which is
  // what the next statement opens with) is the sum of the boxes.
  for (const text of L) {
    // HDFC prints ₹ as a glyph that extracts as "C", and draws the minus
    // between the first two boxes as a graphic, so it may be missing
    const m = stripDates(text).replace(/₹|rs\.?|inr/gi, "").replace(/(^|\s)C(?=\d)/g, "$1")
      .match(/(-?[\d,]+\.\d{2})(\s*cr)?\s*-?\s*([\d,]+\.\d{2})\s*\+\s*([\d,]+\.\d{2})\s*\+\s*([\d,]+\.\d{2})\s*=\s*(-?[\d,]+\.\d{2})(\s*cr)?/i);
    if (!m) continue;
    const n = (x) => parseFloat(x.replace(/,/g, ""));
    const opening = m[2] ? -n(m[1]) : n(m[1]);
    const total = m[7] ? -n(m[6]) : n(m[6]);
    const exact = Math.round((opening - n(m[3]) + n(m[4]) + n(m[5])) * 100) / 100;
    put("opening", opening, "summary box");
    put("payments", n(m[3]), "summary box");
    put("purchases", n(m[4]), "summary box");
    put("charges", n(m[5]), "summary box");
    if (Math.abs(exact - total) < 1) { put("closing", exact, "summary box"); out.closingRounded = total; }
    else put("closing", total, "summary box");
    break;
  }

  // (0) Summary boxes read by position, when we have it (PDFs). Some banks
  // stack their labels on two rows (SBI: "Brought Forward … Closing Balance"
  // above "Dr Count … Total Credits"), so reading in order mixes them up;
  // a value belongs to the label printed above it.
  if (lineInput.some((l) => l && typeof l === "object" && Array.isArray(l.items))) {
    positional(lineInput, mode, put);
  }

  for (let i = 0; i < L.length; i++) {
    const text = L[i];
    const labels = labelsIn(text);
    if (!labels.length) continue;
    const nums = numbersIn(text);

    // (1) label followed by its own value before the next label
    const inline = labels.map((lab, k) => {
      const stop = k + 1 < labels.length ? labels[k + 1].at : Infinity;
      const mine = nums.filter((n) => n.at >= lab.end && n.at < stop);
      return { lab, mine };
    });
    const allInline = inline.every((x) => x.mine.length > 0);

    if (labels.length === 1 && nums.length) {
      // one label: (3) table-row form keeps the balance in the LAST column,
      // otherwise (1) the first number after the label is its value
      const { lab, mine } = inline[0];
      const pick = mine.length > 1 && /^(opening|closing)$/.test(lab.name) ? mine[mine.length - 1] : (mine[0] || nums[nums.length - 1]);
      if (COUNT_FIELDS.has(lab.name) || pick.money) put(lab.name, signed(pick, mode), "same line");
      continue;
    }
    if (labels.length > 1 && allInline) {
      inline.forEach(({ lab, mine }) => { const n = mine[0]; if (COUNT_FIELDS.has(lab.name) || n.money) put(lab.name, signed(n, mode), "same line"); });
      continue;
    }

    // (2) a header row of labels: values on one of the next three lines, in order
    if (labels.length > 1) {
      for (let j = i + 1; j <= Math.min(i + 3, L.length - 1); j++) {
        if (labelsIn(L[j]).length) break;
        const vals = numbersIn(L[j]);
        if (vals.length >= labels.length) {
          // a few banks print a "=" / "+" / "-" between the boxes; numbers stay in order
          labels.forEach((lab, k) => {
            const n = vals[k];
            if (COUNT_FIELDS.has(lab.name) ? !n.money : n.money) put(lab.name, signed(n, mode), "summary row");
          });
          break;
        }
      }
    }
  }

  // Statement period: the first line that names one, with two dates on it.
  for (const text of L) {
    if (!/period|from|statement\s+(?:for|of)|\bto\b|\s-\s/i.test(text)) continue;
    const ds = datesIn(text);
    if (ds.length >= 2 && /period|from|statement|account/i.test(text)) {
      const [a, b] = [ds[0].iso, ds[1].iso].sort();
      if (a !== b) { out.from = a; out.to = b; out.found.period = "printed"; break; }
    }
  }
  return out;
}

/* Text of a PDF line rebuilt from its items, with each item's character span,
 * so a label found in the text can be located on the page. */
function spans(line) {
  let text = "", prevEnd = null;
  const items = [];
  for (const it of line.items || []) {
    if (prevEnd !== null && it.x - prevEnd > 1.2) text += " ";
    items.push({ at: text.length, end: text.length + it.str.length, x0: it.x, x1: it.x + it.w, str: it.str });
    text += it.str;
    prevEnd = it.x + it.w;
  }
  return { text, items };
}
const xRange = (sp, at, end) => {
  const hit = sp.items.filter((it) => it.end > at && it.at < end);
  if (!hit.length) return null;
  // a label sharing an item with others: interpolate within the item
  const first = hit[0], last = hit[hit.length - 1];
  const fx = (it, c) => it.x0 + ((c - it.at) / Math.max(1, it.end - it.at)) * (it.x1 - it.x0);
  return { x0: fx(first, Math.max(at, first.at)), x1: fx(last, Math.min(end, last.end)) };
};

function positional(lines, mode, put) {
  for (let i = 0; i < lines.length; i++) {
    // a block of label rows…
    const labelRows = [];
    let j = i;
    while (j < lines.length && labelRows.length < 3) {
      const sp = spans(lines[j]);
      const labs = labelsIn(sp.text, { weak: true });
      if (!labs.length || numbersIn(sp.text).some((n) => n.money)) break;
      labelRows.push(...labs.map((l) => ({ ...l, ...xRange(sp, l.at, l.end) })).filter((l) => l.x0 != null));
      j++;
    }
    const strong = labelRows.filter((l) => !l.weak);
    if (labelRows.length < 2 || !strong.length || !labelRows.some((l) => /opening|closing|Count/.test(l.name))) continue;
    // …then the value rows under it (no dates: a dated row is a transaction)
    const vals = [];
    for (let k = j; k < Math.min(j + 3, lines.length); k++) {
      const sp = spans(lines[k]);
      if (labelsIn(sp.text).length || datesIn(sp.text).length) break;
      for (const n of numbersIn(sp.text)) { const r = xRange(sp, n.at, n.end); if (r) vals.push({ ...n, ...r }); }
    }
    if (vals.length < 2) continue;
    const used = new Set();
    for (const v of vals) {
      const cx = (v.x0 + v.x1) / 2;
      let best = null, bd = Infinity;
      for (const l of labelRows) {
        if (used.has(l)) continue;
        if (COUNT_FIELDS.has(l.name) ? v.money : !v.money) continue;
        const overlap = Math.min(v.x1, l.x1) - Math.max(v.x0, l.x0);
        const d = overlap > 0 ? -overlap : Math.min(Math.abs(cx - l.x0), Math.abs(cx - l.x1));
        if (d < bd) { bd = d; best = l; }
      }
      if (best && bd < 60) { used.add(best); put(best.name, signed(v, mode), "summary box"); }
    }
    i = j;
  }
}

/**
 * Opening and closing balances worked out from the running-balance column,
 * for statements that don't print them (or as a cross-check when they do).
 * `direction` comes from checkBalances and is decided once per statement.
 */
export function balancesFromRows(rows = [], direction = "oldest-first") {
  const b = rows.filter((r) => r.balance != null && isFinite(r.balance));
  if (!b.length) return {};
  const r2 = (n) => Math.round(n * 100) / 100;
  const first = direction === "oldest-first" ? b[0] : b[b.length - 1];
  const last = direction === "oldest-first" ? b[b.length - 1] : b[0];
  return {
    opening: r2(first.balance + (first.debit || 0) - (first.credit || 0)),
    closing: r2(last.balance),
  };
}

/** A description that is a balance line, not a transaction. */
export const BALANCE_LINE_RE = /^(?:opening|closing)\s+bal(?:ance)?\b|^balance\s+(?:b\/f|c\/f|brought|carried)|^b\/f\b|^c\/f\b/i;
