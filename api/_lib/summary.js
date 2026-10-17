/*
 * Statement summary: the figures printed around the transaction table that the
 * table parser deliberately skips — closing balance on a bank statement, and
 * total due / minimum due / payment due date on a card statement.
 *
 * Banks lay these out two ways: "Label: value" on one line, or a row of
 * labels with the values on the line underneath (HDFC card statements do
 * this). Both are handled; anything not found is simply left out.
 */

const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const AMT = /(?:₹|rs\.?|inr)?\s*(-?\d{1,3}(?:,\d{2,3})*(?:\.\d{1,2})?|-?\d+(?:\.\d{1,2})?)\s*(cr|dr)?/i;
const DATE = /(\d{1,2})[\/\-. ](\d{1,2}|[A-Za-z]{3,9})[\/\-., ]+(\d{2,4})/;

function toISO(m) {
  if (!m) return null;
  let d = +m[1], mo = /^\d+$/.test(m[2]) ? +m[2] : MON[m[2].slice(0, 3).toLowerCase()], y = +m[3];
  if (y < 100) y += 2000;
  if (!d || !mo || mo > 12 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
const num = (s) => parseFloat(String(s).replace(/,/g, ""));

function amountsIn(text) {
  const out = [];
  const re = new RegExp(AMT.source, "gi");
  let m;
  const stripped = text.replace(DATE, " ");
  while ((m = re.exec(stripped))) {
    if (!/[.,]/.test(m[1]) && m[1].length < 3) continue; // skip stray small integers
    out.push({ v: num(m[1]), cr: /cr/i.test(m[2] || "") });
  }
  return out;
}

export function summarizeStatement(lineTexts = []) {
  const L = lineTexts.map((t) => String(t || "").replace(/\s+/g, " ").trim());
  const out = {};
  const find = (re) => L.findIndex((t) => re.test(t));

  // Label: value on the same line
  const sameLine = (re) => {
    const i = find(re);
    if (i < 0) return null;
    const after = L[i].replace(re, " ");
    const a = amountsIn(after);
    return a.length ? a[0] : null;
  };

  const closing = sameLine(/closing\s+balance|balance\s+as\s+on|available\s+balance/i);
  if (closing) out.closingBalance = closing.cr === false && /dr/i.test(L[find(/closing\s+balance/i)] || "") ? -closing.v : closing.v;

  // Card statements: a header row of labels, values on the next line(s)
  const hi = find(/payment\s+due\s+date/i);
  if (hi >= 0) {
    const sameDate = toISO(L[hi].match(DATE));
    if (sameDate) out.dueDate = sameDate;
    for (let j = hi; j <= Math.min(hi + 3, L.length - 1) && !out.dueDate; j++) {
      const d = toISO(L[j].match(DATE));
      if (d) out.dueDate = d;
    }
    const header = L[hi];
    const labels = ["payment due date", "total dues", "total amount due", "minimum amount due", "minimum due"]
      .map((l) => ({ l, at: header.toLowerCase().indexOf(l) })).filter((x) => x.at >= 0).sort((a, b) => a.at - b.at);
    for (let j = hi + 1; j <= Math.min(hi + 3, L.length - 1); j++) {
      const a = amountsIn(L[j]);
      const amtLabels = labels.filter((x) => !/date/.test(x.l));
      if (a.length >= amtLabels.length && amtLabels.length) {
        amtLabels.forEach((x, k) => {
          if (/total/.test(x.l)) out.amountDue = a[k].v;
          if (/minimum/.test(x.l)) out.minDue = a[k].v;
        });
        break;
      }
    }
  }
  if (out.amountDue == null) { const t = sameLine(/total\s+(amount\s+)?dues?|total\s+amount\s+due|amount\s+payable/i); if (t) out.amountDue = t.v; }
  if (out.minDue == null) { const t = sameLine(/minimum\s+(amount\s+)?due/i); if (t) out.minDue = t.v; }
  const sd = find(/statement\s+date/i);
  if (sd >= 0) { const d = toISO(L[sd].match(DATE)) || toISO((L[sd + 1] || "").match(DATE)); if (d) out.statementDate = d; }
  return out;
}
