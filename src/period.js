/*
 * Ledger months.
 *
 * By default a ledger month is the calendar month. With a custom start day
 * (Settings → "Month starts on day N", e.g. salary day or a card's billing
 * cycle), the month labelled "October" runs from N October to (N-1) November.
 * Every place that asks "which month does this date belong to" goes through
 * periodOf(), so the whole app moves together.
 */

let START = 1;
export const setMonthStart = (n) => { START = Math.min(28, Math.max(1, parseInt(n, 10) || 1)); };
export const getMonthStart = () => START;

const pad = (n) => String(n).padStart(2, "0");
const key = (y, m) => { const d = new Date(y, m - 1, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
const parts = (k) => k.split("-").map(Number);
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const todayIso = () => iso(new Date());

/** The ledger month (YYYY-MM) a YYYY-MM-DD date belongs to. */
export function periodOf(dateStr) {
  const s = String(dateStr || "");
  if (START === 1) return s.slice(0, 7);
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  return d >= START ? s.slice(0, 7) : key(y, m - 1);
}
export const currentPeriod = () => periodOf(todayIso());

/** First and last day (YYYY-MM-DD) of a ledger month, and its length. */
export function periodRange(k) {
  const [y, m] = parts(k);
  const start = new Date(y, m - 1, START);
  const end = new Date(y, m, START - 1);
  return { start: iso(start), end: iso(end), days: Math.round((end - start) / 864e5) + 1 };
}
export const periodDays = (k) => periodRange(k).days;

/** 1-based day number of a date within its ledger month. */
export function dayIndex(dateStr, k) {
  const { start } = periodRange(k);
  return Math.round((Date.parse(dateStr) - Date.parse(start)) / 864e5) + 1;
}

/** The date inside ledger month k that falls on day-of-month `dom`. */
export function dateOnDay(k, dom) {
  const [y, m] = parts(k);
  const mm = dom >= START ? m : m + 1;
  const last = new Date(y, mm, 0).getDate();
  return iso(new Date(y, mm - 1, Math.min(dom, last)));
}

/** All dates of a ledger month, in order. */
export function periodDates(k) {
  const { start, days } = periodRange(k);
  const s = new Date(Date.parse(start + "T00:00:00"));
  return Array.from({ length: days }, (_, i) => iso(new Date(s.getFullYear(), s.getMonth(), s.getDate() + i)));
}

/** "October 2026", or "25 Oct – 24 Nov 2026" with a custom start. */
export function periodLabel(k, long = true) {
  const [y, m] = parts(k);
  if (START === 1) return new Date(y, m - 1, 1).toLocaleDateString("en-US", long ? { month: "long", year: "numeric" } : { month: "short" });
  const { start, end } = periodRange(k);
  const f = (d, withYear) => new Date(d + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}) });
  return `${f(start)} – ${f(end, long)}`;
}
export const shortDate = (d) => new Date(d + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" });
