import React, { useState, useMemo, useEffect } from "react";
import { Info, Search } from "lucide-react";
import {
  money, monthLabel, shiftMonth, monthKey, budgetFor, uid, BANKS, NONSPEND_SECTION,
} from "../ExpenseLedger.jsx";
import { merchantKey } from "../api/_lib/categorize.js";
import { periodOf, currentPeriod, dateOnDay, periodLabel } from "./period.js";

/*
 * Money in.
 *
 * Income is no longer a planned figure. It is traced from the credits on the
 * bank statements you import: every credit is kept, sorted into a kind, and
 * only the kinds that are genuinely income (salary, rent, interest, other
 * income) count. Refunds, office-claim reimbursements, transfers between your
 * own accounts and credit-card bill payments are recorded but never counted —
 * counting them would inflate income twice over.
 *
 * Anything the rules can't place is "Not sure yet": shown, not counted, until
 * you sort it. Sorting a credit teaches the ledger that payer, the same way
 * clearing Suspense teaches merchant memory.
 */

export const CREDIT_KINDS = {
  salary:       { label: "Salary",                income: true },
  rent:         { label: "Rent received",         income: true },
  interest:     { label: "Interest & dividends",  income: true },
  other_income: { label: "Other income",          income: true },
  refund:       { label: "Refund / cashback",     income: false },
  claim:        { label: "Office claim repaid",   income: false },
  transfer:     { label: "Own-account transfer",  income: false },
  card_payment: { label: "Card bill payment",     income: false },
  unsure:       { label: "Not sure yet",          income: false },
};
export const KIND_ORDER = Object.keys(CREDIT_KINDS);
export const isIncome = (k) => !!(CREDIT_KINDS[k] && CREDIT_KINDS[k].income);

const modeOf = (bank) => BANKS.find((b) => b.key === bank)?.mode || "";
export const creditDupKey = (c) => `${c.bank || ""}|${c.date}|${Math.round(c.amount)}|${merchantKey(c.note || c.desc || "")}`;

/** Decide what a credit is. Returns { kind, reason }. */
export function classifyCredit(t, { creditMap = {}, expenses = [] } = {}) {
  const d = String(t.desc || t.note || "").toUpperCase();
  const key = merchantKey(d);
  const has = (re) => re.test(d);

  if (modeOf(t.bank) === "card") {
    if (has(/REFUND|REVERSAL|REVERSED|CASHBACK|CASH BACK|RETURN/)) return { kind: "refund", reason: "refund on the card" };
    return { kind: "card_payment", reason: "credit on a card statement = bill paid" };
  }
  if (key && creditMap[key]) return { kind: creditMap[key], reason: "you filed this payer before" };
  if (has(/SALARY|\bSAL\b|SAL CR|SAL FOR|PAYROLL|STIPEND/)) return { kind: "salary", reason: "says salary" };
  if (has(/\bRENT\b|RENTAL/)) return { kind: "rent", reason: "says rent" };
  if (has(/INT\.?\s?PD|INTEREST|INT CR|CR INT|\bINT\b.*CREDIT|DIVIDEND|\bDIV\b/)) return { kind: "interest", reason: "interest / dividend" };
  if (has(/REFUND|REVERSAL|REVERSED|CASHBACK|CASH BACK|\bRET\b|RETURN/)) return { kind: "refund", reason: "refund / reversal" };
  if (has(/CLAIM|REIMB|EXP REIMB|TRAVEL EXP/)) return { kind: "claim", reason: "claim reimbursement" };
  if (has(/\bSELF\b|OWN A\/?C|SWEEP|FD CLOS|FD PREMAT|TRANSFER FROM OWN/)) return { kind: "transfer", reason: "own-account transfer" };

  // A debit of the same amount from another of your accounts within two days
  // is almost certainly money moving between your own accounts.
  const day = Date.parse(t.date);
  const twin = expenses.find((e) => e.bank && e.bank !== t.bank && Math.round(e.amount) === Math.round(t.amount)
    && Math.abs(Date.parse(e.date) - day) <= 2 * 864e5 && modeOf(e.bank) === "savings");
  if (twin) return { kind: "transfer", reason: `matches a ${money(twin.amount, "₹")} debit from ${BANKS.find((b) => b.key === twin.bank)?.label || twin.bank}` };

  return { kind: "unsure", reason: "couldn't tell — please sort" };
}

/** Income for one month, from recorded credits. */
export function monthIncome(credits, k) {
  const out = { total: 0, byKind: {}, unsure: 0, unsureAmt: 0, n: 0, has: false };
  for (const c of credits || []) {
    if (!c.date || periodOf(c.date) !== k) continue;
    out.has = true;
    out.byKind[c.kind] = (out.byKind[c.kind] || 0) + c.amount;
    if (isIncome(c.kind)) { out.total += c.amount; out.n += 1; }
    if (c.kind === "unsure") { out.unsure += 1; out.unsureAmt += c.amount; }
  }
  return out;
}

export const ordinal = (n) => n + (["th", "st", "nd", "rd"][(n % 100 > 10 && n % 100 < 14) || n % 10 > 3 ? 0 : n % 10]);

/** Typical day of the month a kind of credit arrives (median), or null. */
export function typicalDay(credits, kind) {
  const days = (credits || []).filter((c) => c.kind === kind).map((c) => Number(c.date.slice(8, 10))).sort((a, b) => a - b);
  return days.length >= 2 ? days[Math.floor(days.length / 2)] : null;
}

/* ------------------------------------------------------------------ */
/*  Due dates                                                          */
/* ------------------------------------------------------------------ */
export const BILL_SECTIONS = ["Household Fixed", "Utilities", "Annual", "Insurance", "LIC Policies"];
export const NOT_A_BILL = /grocery|flower|laundry/i;
/* How often a bill falls due, in months. A category can carry:
 *   freq      one of these keys, or "none" (explicitly not a bill)
 *   dueDay    1–31
 *   dueMonth  1–12 — any month in which it falls due (anchors non-monthly cycles)
 *   billAmt   amount of each bill, for non-monthly bills
 *   autopay   true when debited automatically
 * Categories without `freq` keep the old behaviour (bill by section, monthly). */
export const FREQS = { monthly: 1, bimonthly: 2, quarterly: 3, halfyearly: 6, yearly: 12 };
export const FREQ_LABEL = { monthly: "Monthly", bimonthly: "Bi-monthly", quarterly: "Quarterly", halfyearly: "Half-yearly", yearly: "Yearly", none: "Not a bill" };
export const MONTHS3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const isBillCat = (c) => !!c && (c.freq ? c.freq !== "none" : BILL_SECTIONS.includes(c.section) && !NOT_A_BILL.test(c.name));

/** Does a bill with a frequency fall due in ledger month k? */
export function isDueIn(c, k) {
  const step = FREQS[c.freq];
  if (!step || step === 1 || !c.dueMonth) return true;
  const m = Number(k.slice(5, 7));
  return (((m - c.dueMonth) % step) + step) % step === 0;
}

/** Months in which a bill falls due, e.g. "Mar · Jun · Sep · Dec". */
export function dueMonthsLabel(c) {
  const step = FREQS[c.freq];
  if (!step || step === 1 || !c.dueMonth) return "";
  const out = [];
  for (let m = 1; m <= 12; m++) if ((((m - c.dueMonth) % step) + step) % step === 0) out.push(MONTHS3[m - 1]);
  return out.join(" · ");
}

/** Amount of one bill. Non-monthly: the amount set for it, else the year's budget spread over its payments. */
function billAmountFor(c, k, expenses) {
  const step = FREQS[c.freq];
  let amt;
  if (step && step > 1) amt = c.billAmt > 0 ? c.billAmt : Math.round((c.monthly || []).reduce((s, x) => s + (x || 0), 0) * step / 12);
  else amt = budgetFor(c, k);
  if (amt > 0 || !c.freq) return amt;
  // No budget at all (e.g. a non-spend category): use the last month it was paid.
  let last = "", sum = 0;
  for (const e of expenses) if (e.cat === c.id && periodOf(e.date) < k && periodOf(e.date) > last) last = periodOf(e.date);
  if (last) for (const e of expenses) if (e.cat === c.id && periodOf(e.date) === last) sum += e.amount;
  return sum;
}

const normName = (s) => String(s || "").toLowerCase().replace(/[‐-―]/g, "-").replace(/\s+/g, " ").trim();
const parseFreq = (v) => {
  const s = String(v || "").toLowerCase().replace(/[^a-z]/g, "");
  if (!s) return null;
  if (s.startsWith("notabill") || s === "none" || s === "no") return "none";
  if (s.startsWith("bimonth") || s === "every2months" || s === "everytwomonths") return "bimonthly";
  if (s.startsWith("halfyear") || s.startsWith("semiannual")) return "halfyearly";
  if (s.startsWith("quarter")) return "quarterly";
  if (s.startsWith("year") || s.startsWith("annual")) return "yearly";
  if (s.startsWith("month")) return "monthly";
  return undefined; // unreadable
};
const parseMonth = (v) => {
  if (v === "" || v == null) return null;
  const n = Number(v);
  if (Number.isInteger(n) && n >= 1 && n <= 12) return n;
  const i = MONTHS3.findIndex((m) => String(v).trim().toLowerCase().startsWith(m.toLowerCase()));
  return i >= 0 ? i + 1 : undefined;
};

/**
 * Apply rows from the "Bill Due Dates" sheet (sheet_to_json objects keyed by header).
 * Matches rows to categories, or to credit cards, by name. Rows with a blank
 * Frequency are left alone. Returns new categories + cardDue and a report.
 */
export function applyDueSheet(rows, categories, cardDue, cards) {
  const col = (row, re) => { const k = Object.keys(row).find((h) => re.test(h.trim())); return k ? row[k] : ""; };
  const byName = new Map(categories.map((c) => [normName(c.name), c]));
  const cardByName = new Map(cards.map((b) => [normName(b.label), b]));
  const patch = {}, nextCard = { ...cardDue };
  const report = { bills: 0, notBills: 0, cards: 0, skipped: [], unmatched: [], problems: [] };
  for (const row of rows) {
    const name = String(col(row, /^category/i) || "").trim();
    if (!name) continue;
    const freq = parseFreq(col(row, /^frequency/i));
    if (freq === null) { report.skipped.push(name); continue; }
    if (freq === undefined) { report.problems.push(`${name}: frequency "${col(row, /^frequency/i)}" not understood`); continue; }
    const dayRaw = col(row, /^due ?day/i);
    const day = dayRaw === "" ? null : Number(dayRaw);
    if (day != null && !(Number.isInteger(day) && day >= 1 && day <= 31)) { report.problems.push(`${name}: due day "${dayRaw}" isn't 1–31`); continue; }
    const card = cardByName.get(normName(name));
    if (card) {
      if (freq === "none" || !day) delete nextCard[card.key]; else nextCard[card.key] = day;
      report.cards++; continue;
    }
    const c = byName.get(normName(name));
    if (!c) { report.unmatched.push(name); continue; }
    if (freq === "none") { patch[c.id] = { freq: "none", dueDay: undefined, dueMonth: undefined, billAmt: undefined, autopay: undefined }; report.notBills++; continue; }
    const step = FREQS[freq];
    const month = parseMonth(col(row, /^due ?month/i));
    if (month === undefined) { report.problems.push(`${name}: due month "${col(row, /^due ?month/i)}" not understood`); continue; }
    if (step > 1 && !month) { report.problems.push(`${name}: ${FREQ_LABEL[freq].toLowerCase()} needs a due month`); continue; }
    const amt = Number(String(col(row, /amount/i)).replace(/[^\d.]/g, ""));
    const ap = String(col(row, /^autopay/i)).trim().toLowerCase();
    patch[c.id] = {
      freq, dueDay: day || undefined, dueMonth: step > 1 ? month : undefined,
      billAmt: step > 1 && amt > 0 ? amt : undefined,
      autopay: ap.startsWith("y") ? true : undefined,
    };
    report.bills++;
  }
  const next = categories.map((c) => {
    const p = patch[c.id];
    if (!p) return c;
    const n = { ...c, ...p };
    for (const k of Object.keys(p)) if (p[k] === undefined) delete n[k];
    return n;
  });
  return { categories: next, cardDue: nextCard, report };
}

/** The sheet's rows from the ledger as it stands, for download. */
export function dueSheetRows(categories, cardDue, cards, sections) {
  const head = ["Section", "Category", "Planned amount (₹)", "Frequency", "Due day (1–31)", "Due month", "Autopay (Y/N)", "Notes"];
  const out = [head];
  const order = (c) => { const i = sections.indexOf(c.section); return i < 0 ? 99 : i; };
  const cats = [...categories].sort((a, b) => order(a) - order(b));
  const catRow = (c) => {
    const step = FREQS[c.freq];
    const amt = step > 1 ? (c.billAmt || "") : (c.monthly?.[new Date().getMonth()] || "");
    return [c.section, c.name, amt, c.freq ? FREQ_LABEL[c.freq] : "", c.dueDay || "", c.dueMonth ? MONTHS3[c.dueMonth - 1] : "", c.autopay ? "Y" : (c.freq && c.freq !== "none" ? "N" : ""), ""];
  };
  cats.filter((c) => c.section !== NONSPEND_SECTION).forEach((c) => out.push(catRow(c)));
  for (const b of cards) out.push(["Credit Cards", b.label, "", cardDue[b.key] ? "Monthly" : "", cardDue[b.key] || "", "", "", "Card bill due day"]);
  cats.filter((c) => c.section === NONSPEND_SECTION).forEach((c) => out.push(catRow(c)));
  return out;
}

/** The day of the month a category is usually paid: median over its last 6 months of entries. */
export function inferDueDay(catId, expenses) {
  const since = shiftMonth(currentPeriod(), -6);
  const byMonth = {};
  for (const e of expenses) {
    if (e.cat !== catId || e.date.slice(0, 7) < since) continue;
    const m = e.date.slice(0, 7), d = Number(e.date.slice(8, 10));
    byMonth[m] = Math.min(byMonth[m] || 99, d); // first payment in each month
  }
  const days = Object.values(byMonth).sort((a, b) => a - b);
  return days.length >= 2 ? days[Math.floor(days.length / 2)] : null;
}
export const dueDayOf = (c, expenses) => (c.dueDay ? { day: c.dueDay, inferred: false } : (() => { const d = inferDueDay(c.id, expenses); return d ? { day: d, inferred: true } : null; })());

const clampDay = (k, d) => { const [y, m] = k.split("-").map(Number); return Math.min(d, new Date(y, m, 0).getDate()); };
const isoOf = (k, d) => `${k}-${String(clampDay(k, d)).padStart(2, "0")}`;

/**
 * Every bill in a month with its due date and where it stands:
 * paid · part · overdue · soon (≤7 days) · upcoming · nodate.
 * Card bills come from the due day set per card; the amount is last month's
 * spend on that card, and it counts as paid once a card-payment credit for
 * that card is recorded in the month.
 */
export function billsForMonth({ categories, expenses, credits = [], cardDue = {}, balances = {}, selMonth }) {
  const today = new Date();
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const spentBy = {};
  for (const e of expenses) if (periodOf(e.date) === selMonth) spentBy[e.cat] = (spentBy[e.cat] || 0) + e.amount;

  const status = (paidAmt, due, date) => {
    if (paidAmt >= due * 0.9) return "paid";
    if (!date) return paidAmt > 0 ? "part" : "nodate";
    if (date < todayIso) return paidAmt > 0 ? "part" : "overdue";
    const days = Math.round((Date.parse(date) - Date.parse(todayIso)) / 864e5);
    if (paidAmt > 0) return "part";
    return days <= 7 ? "soon" : "upcoming";
  };

  const out = [];
  for (const c of categories) {
    if (!isBillCat(c) || (c.section === NONSPEND_SECTION && !c.freq)) continue;
    if (c.freq && !isDueIn(c, selMonth)) continue;
    const due = billAmountFor(c, selMonth, expenses);
    if (due <= 0) continue;
    const dd = dueDayOf(c, expenses);
    const date = dd ? dateOnDay(selMonth, dd.day) : null;
    const paid = spentBy[c.id] || 0;
    const section = FREQS[c.freq] > 1 ? `${c.section} · ${FREQ_LABEL[c.freq].toLowerCase()}` : c.section;
    out.push({ id: c.id, name: c.name, section: c.autopay ? `${section} · autopay` : section, due, paid, date, inferred: dd?.inferred, kind: "bill", status: status(paid, due, date) });
  }
  const prev = shiftMonth(selMonth, -1);
  for (const b of BANKS.filter((x) => x.mode === "card")) {
    // A statement that states its own due date in this month beats any estimate.
    const st = (balances[b.key] || []).find((x) => x.dueDate && periodOf(x.dueDate) === selMonth && x.amountDue != null);
    if (st) {
      const paid = credits.filter((c) => c.bank === b.key && c.kind === "card_payment" && c.date >= (st.statementDate || st.asOf || "0")).reduce((s, c) => s + c.amount, 0);
      out.push({ id: "card:" + b.key, name: `${b.label} bill`, section: `from statement${st.minDue ? ` · min ${money(st.minDue, "₹")}` : ""}`, due: st.amountDue, paid, date: st.dueDate, kind: "card", status: status(paid, st.amountDue, st.dueDate) });
      continue;
    }
    const day = cardDue[b.key];
    if (!day) continue;
    const due = expenses.filter((e) => e.bank === b.key && periodOf(e.date) === prev).reduce((s, e) => s + e.amount, 0);
    if (due <= 0) continue;
    const paid = credits.filter((c) => c.bank === b.key && c.kind === "card_payment" && periodOf(c.date) === selMonth).reduce((s, c) => s + c.amount, 0);
    const date = dateOnDay(selMonth, day);
    out.push({ id: "card:" + b.key, name: `${b.label} bill`, section: `${monthLabel(prev, { month: "short" })} card spend`, due, paid, date, kind: "card", status: status(paid, due, date) });
  }
  const rank = { overdue: 0, soon: 1, part: 2, upcoming: 3, nodate: 4, paid: 5 };
  return out.sort((a, b) => rank[a.status] - rank[b.status] || (a.date || "9").localeCompare(b.date || "9") || b.due - a.due);
}

/** A refund can be set against the category it came back to, which lowers that category's spend. */
export function RefundCat({ categories, value, onChange }) {
  return (
    <select className="kind-sel" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Refund against which category">
      <option value="">Refund for… (lowers that spend)</option>
      {categories.filter((c) => c.section !== NONSPEND_SECTION).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
    </select>
  );
}
export function guessRefundCat(desc, expenses) {
  const k = merchantKey(desc || "");
  if (!k) return "";
  const hit = (expenses || []).filter((e) => merchantKey(e.note || "") === k).sort((a, b) => b.date.localeCompare(a.date))[0];
  return hit ? hit.cat : "";
}

/* ------------------------------------------------------------------ */
/*  Import step: the credits found in a statement                      */
/* ------------------------------------------------------------------ */
export function MoneyInReview({ items, kinds, setKinds, include, setInclude, dup, sym, categories = [], cats = {}, setCats = () => {} }) {
  const [open, setOpen] = useState(true);
  if (!items.length) return null;
  const counted = items.filter((t) => include[t.key] && isIncome(kinds[t.key])).reduce((s, t) => s + t.amount, 0);
  const unsure = items.filter((t) => include[t.key] && kinds[t.key] === "unsure").length;
  return (
    <div className="mi-review">
      <button type="button" className="mi-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span><strong>Money in · {items.length}</strong> credit{items.length === 1 ? "" : "s"} — <span className="t-teal num">{money(counted, sym)}</span> counted as income{unsure ? <span className="t-amber"> · {unsure} to sort</span> : null}</span>
        <span className="mi-toggle">{open ? "Hide" : "Show"}</span>
      </button>
      {open && <>
        <div className="imp-note"><Info size={14} /> Only Salary, Rent, Interest and Other income count as income. Refunds, claims, own-account transfers and card payments are kept for reference but not counted.</div>
        <div className="rev-list" style={{ maxHeight: "30vh" }}>
          {items.map((t) => (
            <div className={`rev-row mi-row ${!include[t.key] ? "off" : ""}`} key={t.key}>
              <input type="checkbox" checked={!!include[t.key]} onChange={(e) => setInclude({ ...include, [t.key]: e.target.checked })} aria-label="Include this credit" />
              <div className="rev-main">
                <span className="rev-desc">{t.desc || "—"}{dup[t.key] && <span className="dupbadge">already recorded?</span>}</span>
                <span className="rev-meta num">{t.date || "no date"} · <span className="t-teal">+{money(t.amount, sym)}</span> · {t.reason}</span>
              </div>
              <span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <select className={`kind-sel k-${kinds[t.key]}`} value={kinds[t.key]} onChange={(e) => setKinds({ ...kinds, [t.key]: e.target.value })} aria-label="What is this credit">
                  {KIND_ORDER.map((k) => <option key={k} value={k}>{CREDIT_KINDS[k].label}</option>)}
                </select>
                {kinds[t.key] === "refund" && <RefundCat categories={categories} value={cats[t.key] || ""} onChange={(v) => setCats({ ...cats, [t.key]: v })} />}
              </span>
            </div>
          ))}
        </div>
      </>}
    </div>
  );
}

/* A credit's own remark ("Loan from Saryu"), kept apart from the bank's text,
 * which the duplicate check relies on. Saves when the field loses focus. */
function RemarkInput({ value, onSave }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const commit = () => { const t = v.trim(); if (t !== value) onSave(t); };
  return (
    <input className="cl-remark" placeholder="Add a remark…" value={v} aria-label="Remark"
      onChange={(e) => setV(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { setV(value); } }} />
  );
}

/* ------------------------------------------------------------------ */
/*  Income tab                                                         */
/* ------------------------------------------------------------------ */
export function IncomeView({ credits, selMonth, sym, onSetKind, onSetCat, onSetRemark, onAdd, onDelete, categories = [] }) {
  const [q, setQ] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [form, setForm] = useState({ date: `${selMonth}-01`, amount: "", note: "", kind: "other_income", bank: "cash" });
  const mi = monthIncome(credits, selMonth);
  const rows = credits.filter((c) => periodOf(c.date) === selMonth)
    .filter((c) => showAll || c.kind !== "card_payment")
    .filter((c) => !q || `${c.remark || ""} ${c.note || ""}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (a.kind === "unsure" ? -1 : 0) - (b.kind === "unsure" ? -1 : 0) || b.date.localeCompare(a.date));
  const months = useMemo(() => { const a = []; for (let i = 5; i >= 0; i--) a.push(shiftMonth(selMonth, -i)); return a; }, [selMonth]);
  const table = months.map((k) => ({ k, ...monthIncome(credits, k) }));
  const shownKinds = KIND_ORDER.filter((k) => table.some((r) => r.byKind[k]));
  const salaryDay = typicalDay(credits, "salary");

  return (
    <div className="hist-wrap">
      <section className="panel">
        <div className="card-head">
          <h2>Money in · {periodLabel(selMonth)}</h2>
          <span className="card-meta">{salaryDay ? `Salary usually arrives around the ${ordinal(salaryDay)}` : ""}</span>
        </div>
        {!mi.has ? (
          <div className="empty">No credits recorded for {monthLabel(selMonth, { month: "long" })} yet. They're picked up automatically when you import this month's bank statements.</div>
        ) : (
          <div className="mi-kpis">
            <div><span className="pf-label">Income received</span><span className="pf-value num t-teal">{money(mi.total, sym)}</span></div>
            {KIND_ORDER.filter((k) => mi.byKind[k]).map((k) => (
              <div key={k}><span className="pf-label">{CREDIT_KINDS[k].label}{CREDIT_KINDS[k].income ? "" : " · not counted"}</span><span className={`pf-value num ${k === "unsure" ? "t-amber" : ""}`} style={{ fontSize: 17 }}>{money(mi.byKind[k], sym)}</span></div>
            ))}
          </div>
        )}
        {mi.unsure > 0 && <div className="imp-readnote" style={{ marginTop: 12 }}><Info size={14} /> {mi.unsure} credit{mi.unsure === 1 ? "" : "s"} ({money(mi.unsureAmt, sym)}) still to sort — they aren't counted as income until you do.</div>}

        {mi.has && <>
          <div className="rev-tools" style={{ margin: "14px 0 8px" }}>
            <div className="rev-search"><Search size={14} /><input placeholder="Filter credits…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
            <label className="chk-inline"><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Show card bill payments</label>
          </div>
          <ul className="credit-list">
            {rows.map((c) => (
              <li key={c.id} className={c.kind === "unsure" ? "unsure" : ""}>
                <span className="num cl-date">{c.date.slice(8, 10)} {monthLabel(c.date.slice(0, 7), { month: "short" })}</span>
                <span className="cl-main">
                  {onSetRemark && <RemarkInput value={c.remark || ""} onSave={(v) => onSetRemark(c.id, v)} />}
                  <span className="cl-note" title={c.note || ""}>{c.note || "—"}</span><span className="cl-bank">{BANKS.find((b) => b.key === c.bank)?.label || c.bank || "—"}</span></span>
                <span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <select className={`kind-sel k-${c.kind}`} value={c.kind} onChange={(e) => onSetKind(c.id, e.target.value)} aria-label="What is this credit">
                    {KIND_ORDER.map((k) => <option key={k} value={k}>{CREDIT_KINDS[k].label}</option>)}
                  </select>
                  {c.kind === "refund" && <RefundCat categories={categories} value={c.cat || ""} onChange={(v) => onSetCat(c.id, v)} />}
                </span>
                <span className={`num cl-amt ${isIncome(c.kind) ? "t-teal" : ""}`}>+{money(c.amount, sym)}</span>
                <button className="en-del" aria-label="Delete credit" onClick={() => onDelete(c.id)}>×</button>
              </li>
            ))}
            {!rows.length && <li className="empty">Nothing matches.</li>}
          </ul>
        </>}

        <details className="mi-add">
          <summary>Add money in by hand (cash, a card payment or refund, a cheque not yet on a statement)</summary>
          <div className="mi-add-row">
            <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} aria-label="Date" />
            <input type="number" min="0" placeholder="Amount" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} aria-label="Amount" />
            <input type="text" placeholder="From / note" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} aria-label="Note" />
            <select value={form.bank} onChange={(e) => setForm({ ...form, bank: e.target.value })} aria-label="Account">
              {BANKS.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
            </select>
            <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} aria-label="Kind">
              {KIND_ORDER.filter((k) => k !== "unsure").map((k) => <option key={k} value={k}>{CREDIT_KINDS[k].label}</option>)}
            </select>
            <button className="btn-add" disabled={!(parseFloat(form.amount) > 0)} onClick={() => {
              onAdd({ id: uid(), date: form.date, amount: parseFloat(form.amount), note: form.note.trim() || "Added by hand", kind: form.kind, bank: form.bank, src: "manual" });
              setForm({ ...form, amount: "", note: "" });
            }}>Add</button>
          </div>
        </details>
      </section>

      <section className="panel">
        <div className="card-head"><h2>Last 6 months</h2></div>
        <div className="mom-scroll">
          <table className="mom-table num">
            <thead><tr><th className="mom-cat">Kind</th>{table.map((r) => <th key={r.k} className={r.k === selMonth ? "mom-sel" : ""}>{monthLabel(r.k, { month: "short" })}</th>)}</tr></thead>
            <tbody>
              {shownKinds.map((k) => (
                <tr key={k} className={CREDIT_KINDS[k].income ? "" : "mom-ns"}>
                  <td className="mom-cat">{CREDIT_KINDS[k].label}</td>
                  {table.map((r) => <td key={r.k} className={r.k === selMonth ? "mom-sel" : ""}>{r.byKind[k] ? money(r.byKind[k], "") : "–"}</td>)}
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td className="mom-cat">Income</td>{table.map((r) => <td key={r.k} className={r.k === selMonth ? "mom-sel" : ""}>{r.has ? money(r.total, "") : "no statements"}</td>)}</tr></tfoot>
          </table>
        </div>
        <p className="card-note">Grey rows are recorded but never counted as income.</p>
      </section>
    </div>
  );
}

export const incomeCss = `
.t-amber{color:var(--amber)!important;}
.mi-review{border:1px solid var(--hairline); border-radius:12px; background:var(--surface); padding:10px 12px; display:flex; flex-direction:column; gap:10px;}
.mi-head{display:flex; justify-content:space-between; align-items:center; gap:10px; border:0; background:none; padding:2px 0; font:inherit; font-size:13px; color:var(--ink); cursor:pointer; text-align:left;}
.mi-toggle{font-size:12px; color:var(--teal); font-weight:600;}
.mi-row{grid-template-columns:auto 1fr minmax(170px,200px)!important;}
.kind-sel{border:1px solid var(--hairline); border-radius:9px; padding:7px 8px; font:500 12.5px Inter,sans-serif; background:var(--surface); color:var(--ink);}
.kind-sel.k-salary,.kind-sel.k-rent,.kind-sel.k-interest,.kind-sel.k-other_income{border-color:var(--teal); background:var(--teal-soft); color:var(--teal);}
.kind-sel.k-unsure{border-color:var(--amber); background:#FFFBF4; color:var(--amber);}
.mi-kpis{display:flex; flex-wrap:wrap; gap:14px 28px;}
.mi-kpis > div{display:flex; flex-direction:column; gap:2px;}
.credit-list{list-style:none; margin:0; padding:0;}
.credit-list li{display:grid; grid-template-columns:60px minmax(0,1fr) 190px 110px 28px; gap:10px; align-items:center; padding:8px 0; border-bottom:1px solid var(--hairline); font-size:13px;}
.credit-list li.unsure{background:#FFFBF4;}
.cl-main{display:flex; flex-direction:column; min-width:0;}
.cl-note{overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
.cl-remark{border:1px solid transparent; border-radius:7px; padding:2px 6px; margin:0 0 2px -6px; font:600 13px Inter,sans-serif; color:var(--ink); background:transparent; min-width:0;}
.cl-remark:hover{border-color:var(--hairline);} .cl-remark:focus{outline:none; border-color:var(--teal); background:var(--surface);}
.cl-remark::placeholder{color:var(--muted); font-weight:400;}
.cl-remark:placeholder-shown + .cl-note{font-weight:400;}
.cl-bank{font-size:11.5px; color:var(--muted);}
.cl-date{font-size:12px; color:var(--muted);}
.cl-amt{text-align:right; font-weight:600;}
.mi-add{margin-top:14px; font-size:13px;}
.mi-add summary{cursor:pointer; color:var(--teal); font-weight:600; padding:6px 0;}
.mi-add-row{display:flex; flex-wrap:wrap; gap:8px; margin-top:8px;}
.mi-add-row input,.mi-add-row select{height:40px; border:1px solid var(--hairline); border-radius:10px; padding:0 10px; font:500 13px Inter,sans-serif; background:var(--surface); color:var(--ink);}
.mi-add-row input[type=text]{flex:1 1 180px;}
.bill-date{display:flex; flex-direction:column; align-items:center; width:46px; flex:none; line-height:1.1; border-radius:10px; padding:5px 0; background:var(--bg);}
.bill-date strong{font:600 16px 'JetBrains Mono',monospace;}
.bill-date span{font-size:10.5px; color:var(--muted); text-transform:uppercase; letter-spacing:.04em;}
.bill-date.overdue{background:var(--red-soft);} .bill-date.overdue strong,.bill-date.overdue span{color:var(--red);}
.bill-date.soon{background:#FBEEDC;} .bill-date.soon strong,.bill-date.soon span{color:var(--amber);}
.bill-date.paid{opacity:.55;}
.bill-date.nodate strong{color:var(--faint); font-size:13px;}
.bill-list li.is-overdue .bill-name{color:var(--red); font-weight:600;}
.tl{position:relative; height:46px; margin:16px 2px 6px;}
.tl-axis{position:absolute; left:0; right:0; top:22px; height:2px; background:var(--hairline);}
.tl-today{position:absolute; top:8px; bottom:4px; width:2px; background:var(--ink); opacity:.5;}
.tl-mark{position:absolute; top:14px; width:14px; height:14px; margin-left:-7px; border-radius:50%; border:2px solid var(--surface);}
.tl-mark.in{background:var(--teal); top:4px;}
.tl-mark.out{background:var(--ink); top:26px;}
.tl-mark.out.overdue{background:var(--red);} .tl-mark.out.soon{background:var(--amber);} .tl-mark.out.paid{background:#B9C1C6;}
.tl-lbl{position:absolute; bottom:-14px; font-size:10.5px; color:var(--muted); transform:translateX(-50%);}
.tl-legend{display:flex; flex-wrap:wrap; gap:12px; font-size:11.5px; color:var(--muted); margin-top:18px;}
.tl-legend span{display:inline-flex; align-items:center; gap:5px;}
.tl-legend i{width:10px; height:10px; border-radius:50%; display:inline-block;}
.flow-none{font-size:10px; color:var(--faint); text-align:center; line-height:1.2; height:124px; display:flex; align-items:flex-end; padding-bottom:4px;}
.due-in{width:64px!important;}
@media (max-width:820px){
  .credit-list li{grid-template-columns:52px minmax(0,1fr) 96px 24px;}
  .credit-list li .kind-sel{grid-column:2 / 4; grid-row:2;}
  .mi-row{grid-template-columns:auto 1fr!important;}
  .mi-row .kind-sel{grid-column:1 / -1;}
}
`;
