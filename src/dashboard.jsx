import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Plus, X, Check, Delete, RotateCcw, Download, ChevronDown, ChevronUp, Clock, History as HistoryIcon,
} from "lucide-react";
import {
  money, moneySigned, monthLabel, shiftMonth, monthKey, budgetFor, mIdx, todayISO,
  SECTIONS, NONSPEND_SECTION, SUSPENSE_ID, BANKS, BankOptions, api, store,
} from "../ExpenseLedger.jsx";
import { merchantKey } from "../api/_lib/categorize.js";
import { billsForMonth, monthIncome, typicalDay, ordinal, CREDIT_KINDS, isIncome, BILL_SECTIONS, NOT_A_BILL } from "./income.jsx";

/*
 * Dashboard v2 — Wallet-style cards, a YNAB-style "Available" bubble on every
 * budget row, and a Monefy-style amount-first quick add.
 *
 * Every card works from the ledger as it is: expenses, categories with their
 * month-by-month budgets, and the planned income lines. Nothing here invents
 * data — where the ledger doesn't hold something (bill due dates, actual
 * income) the card says what it's based on.
 */

const FIXED_SECTIONS = ["Household Fixed", "Annual", "Insurance", "LIC Policies"];
const YEARLY_SECTIONS = ["Annual", "Insurance", "LIC Policies"];

const SECTION_COLORS = {
  "Household Fixed": "#0E7C6B", "Utilities": "#6CB8A9", "Personal": "#B45309", "Lifestyle": "#E8A15A",
  "Shopping": "#3D5A80", "Annual": "#9DB0C6", "Insurance": "#7A4E8C", "LIC Policies": "#C7A6D3",
  "Uncategorised": "#C02942",
};

const daysIn = (k) => { const [y, m] = k.split("-").map(Number); return new Date(y, m, 0).getDate(); };
const shortAmt = (v, sym) => {
  const a = Math.abs(Math.round(v || 0));
  if (a >= 100000) return `${sym}${(a / 100000).toFixed(a >= 1000000 ? 1 : 2)}L`;
  if (a >= 1000) return `${sym}${Math.round(a / 1000)}k`;
  return `${sym}${a}`;
};
const titleCase = (s) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

/* ------------------------------------------------------------------ */
/*  Shared month figures                                               */
/* ------------------------------------------------------------------ */
export function useMonthFigures({ expenses, categories, catById, selMonth }) {
  return useMemo(() => {
    const isSpend = (e) => catById[e.cat]?.section !== NONSPEND_SECTION;
    const month = expenses.filter((e) => e.date.slice(0, 7) === selMonth && isSpend(e));
    const spentBy = {};
    month.forEach((e) => { spentBy[e.cat] = (spentBy[e.cat] || 0) + e.amount; });
    const spendCats = categories.filter((c) => c.section !== NONSPEND_SECTION);
    const budget = spendCats.reduce((s, c) => s + budgetFor(c, selMonth), 0);
    const spent = month.reduce((s, e) => s + e.amount, 0);
    return { month, spentBy, spendCats, budget, spent };
  }, [expenses, categories, catById, selMonth]);
}

/* ------------------------------------------------------------------ */
/*  KPI strip                                                          */
/* ------------------------------------------------------------------ */
export function KpiStrip({ fig, mi, sym, selMonth }) {
  const today = new Date();
  const cur = monthKey(today);
  const left = fig.budget - fig.spent;
  const daysLeft = selMonth === cur ? daysIn(selMonth) - today.getDate() + 1 : 0;
  const pct = fig.budget > 0 ? Math.round((fig.spent / fig.budget) * 100) : 0;
  const net = mi.total - fig.spent;
  const rate = mi.total > 0 ? Math.round((net / mi.total) * 100) : 0;
  const parts = ["salary", "rent", "interest", "other_income"].filter((k) => mi.byKind[k]).map((k) => `${CREDIT_KINDS[k].label} ${shortAmt(mi.byKind[k], sym)}`);
  const tiles = [
    { label: "Spent", value: money(fig.spent, sym), sub: fig.budget > 0 ? `${pct}% of ${money(fig.budget, sym)} budget` : "No budget this month", tone: pct > 100 ? "red" : "" },
    { label: left < 0 ? "Over budget" : "Left to spend", value: money(left, sym), sub: selMonth === cur ? `${daysLeft} day${daysLeft === 1 ? "" : "s"} to go` : selMonth < cur ? "Month closed" : "Month not started", tone: left < 0 ? "red" : "teal" },
    mi.has
      ? { label: "Income received", value: money(mi.total, sym), sub: (parts.join(" · ") || "No income credits") + (mi.unsure ? ` · ${mi.unsure} to sort` : ""), tone: "", warn: mi.unsure > 0 }
      : { label: "Income received", value: "Awaiting statements", sub: "Traced from credits when this month's bank statements are imported", tone: "pending" },
    mi.has
      ? { label: net < 0 ? "Overspent" : "Saved", value: moneySigned(net, sym), sub: mi.total > 0 ? `${rate}% of income` : "No income counted yet", tone: net < 0 ? "red" : "teal" }
      : { label: "Saved", value: "—", sub: "Shown once income is imported", tone: "pending" },
  ];
  return (
    <section className="kpis" aria-label="Month summary">
      {tiles.map((t) => (
        <div className="kpi" key={t.label}>
          <span className="kpi-label">{t.label}</span>
          <span className={`kpi-value num${t.tone ? " t-" + t.tone : ""}`}>{t.value}</span>
          <span className={`kpi-sub${t.warn ? " t-amber" : ""}`}>{t.sub}</span>
        </div>
      ))}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Spending pace                                                      */
/* ------------------------------------------------------------------ */
export function PaceCard({ fig, catById, selMonth, sym }) {
  const today = new Date();
  const cur = monthKey(today);
  const N = daysIn(selMonth);
  const isCur = selMonth === cur, isPast = selMonth < cur;
  const dayN = isCur ? today.getDate() : isPast ? N : 0;

  const daily = Array(N).fill(0);
  fig.month.forEach((e) => { const d = Number(e.date.slice(8, 10)); if (d >= 1 && d <= N) daily[d - 1] += e.amount; });
  const cum = []; daily.reduce((s, v, i) => (cum[i] = s + v), 0);

  // Forecast: bills still to be paid this month + day-to-day spend at today's pace.
  const sectionOf = (id) => catById[id]?.section;
  let variable = 0;
  fig.month.forEach((e) => { if (!FIXED_SECTIONS.includes(sectionOf(e.cat))) variable += e.amount; });
  const unpaidFixed = fig.spendCats
    .filter((c) => FIXED_SECTIONS.includes(c.section) && !NOT_A_BILL.test(c.name))
    .reduce((s, c) => s + Math.max(0, budgetFor(c, selMonth) - (fig.spentBy[c.id] || 0)), 0);
  const daysLeft = isCur ? N - dayN : 0;
  const forecast = isCur ? fig.spent + (dayN ? (variable / dayN) * daysLeft : 0) + unpaidFixed : fig.spent;
  const overBy = forecast - fig.budget;
  const safe = isCur && daysLeft + 1 > 0 ? Math.max(0, (fig.budget - fig.spent - unpaidFixed) / (daysLeft + 1)) : 0;

  const W = 640, H = 200, L = 20, R = 620, T = 18, B = 176;
  const max = Math.max(fig.budget, forecast, fig.spent, 1) * 1.08;
  const x = (d) => L + ((d) / N) * (R - L);
  const y = (v) => B - (v / max) * (B - T);
  const pts = [`${L},${B}`];
  for (let d = 1; d <= dayN; d++) pts.push(`${x(d).toFixed(1)},${y(cum[d - 1]).toFixed(1)}`);
  const lastX = x(dayN), lastY = y(dayN ? cum[dayN - 1] : 0);

  return (
    <section className="panel card-pace">
      <div className="card-head">
        <h2>Spending pace</h2>
        <span className="card-meta">{isCur ? `Day ${dayN} of ${N}` : isPast ? "Month closed" : "Not started"}</span>
      </div>
      {isCur ? (
        <div className="pace-figs">
          <div>
            <span className="pf-label">Forecast for month-end</span>
            <span className={`pf-value num ${overBy > 0 ? "t-red" : "t-teal"}`}>{money(forecast, sym)}</span>
            <span className={`pf-sub ${overBy > 0 ? "t-red" : ""}`}>{fig.budget > 0 ? (overBy > 0 ? `${money(overBy, sym)} over plan at this pace` : `${money(-overBy, sym)} under plan at this pace`) : "No budget set"}</span>
          </div>
          <div>
            <span className="pf-label">Safe to spend per day</span>
            <span className="pf-value num t-teal">{money(safe, sym)}</span>
            <span className="pf-sub">after {money(unpaidFixed, sym)} of bills still due</span>
          </div>
        </div>
      ) : (
        <div className="pace-figs">
          <div>
            <span className="pf-label">{isPast ? "Spent this month" : "Budget"}</span>
            <span className={`pf-value num ${fig.spent > fig.budget && fig.budget > 0 ? "t-red" : ""}`}>{money(isPast ? fig.spent : fig.budget, sym)}</span>
            <span className="pf-sub">{isPast && fig.budget > 0 ? (fig.spent > fig.budget ? `${money(fig.spent - fig.budget, sym)} over budget` : `${money(fig.budget - fig.spent, sym)} under budget`) : ""}</span>
          </div>
        </div>
      )}
      <svg viewBox={`0 0 ${W} ${H}`} className="pace-svg" role="img"
        aria-label={`Cumulative spend ${money(fig.spent, sym)} by day ${dayN}${isCur ? `, forecast ${money(forecast, sym)}` : ""}, budget ${money(fig.budget, sym)}`}>
        <line x1={L} y1={B} x2={R} y2={B} stroke="var(--hairline)" />
        {fig.budget > 0 && <>
          <line x1={L} y1={y(fig.budget)} x2={R} y2={y(fig.budget)} stroke="var(--ink)" strokeWidth="1.5" strokeDasharray="5 4" />
          <text x={L + 2} y={y(fig.budget) - 6} className="svg-lbl">Budget {shortAmt(fig.budget, sym)}</text>
        </>}
        {dayN > 0 && <polyline points={pts.join(" ")} fill="none" stroke="var(--teal)" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />}
        {isCur && dayN > 0 && <>
          <line x1={lastX} y1={lastY} x2={R} y2={y(forecast)} stroke={overBy > 0 ? "var(--red)" : "var(--teal)"} strokeWidth="2.5" strokeDasharray="2 6" strokeLinecap="round" />
          <circle cx={R} cy={y(forecast)} r="4" fill={overBy > 0 ? "var(--red)" : "var(--teal)"} />
        </>}
        {dayN > 0 && <>
          <circle cx={lastX} cy={lastY} r="5" fill="var(--teal)" stroke="#fff" strokeWidth="2" />
          <text x={Math.min(lastX + 9, R - 90)} y={Math.min(lastY + 16, B - 6)} className="svg-val">{shortAmt(cum[dayN - 1], sym)}{isCur ? " today" : ""}</text>
        </>}
        <text x={L} y={H - 4} className="svg-lbl">1 {monthLabel(selMonth, { month: "short" })}</text>
        <text x={R - 44} y={H - 4} className="svg-lbl">{N} {monthLabel(selMonth, { month: "short" })}</text>
      </svg>
      {isCur && today.getDate() < 25 && (
        <p className="card-note">Card and bank statements usually land after the 22nd, so this month's picture fills in once they're imported.</p>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Bills this month                                                   */
/* ------------------------------------------------------------------ */
export function BillsCard({ categories, expenses, credits, cardDue, selMonth, sym, onSetDue }) {
  const bills = billsForMonth({ categories, expenses, credits, cardDue, selMonth });
  const total = bills.reduce((s, b) => s + b.due, 0);
  const left = bills.reduce((s, b) => s + Math.max(0, b.due - b.paid), 0);
  const overdue = bills.filter((b) => b.status === "overdue");
  const todayMs = Date.parse(new Date().toDateString());
  const dueIn = (d) => Math.round((Date.parse(d) - todayMs) / 864e5);

  const ahead = [];
  for (let i = 1; i <= 3; i++) {
    const k = shiftMonth(selMonth, i);
    const items = categories.filter((c) => YEARLY_SECTIONS.includes(c.section) && budgetFor(c, k) > 0);
    if (items.length) ahead.push({ k, n: items.length, amt: items.reduce((s, c) => s + budgetFor(c, k), 0), names: items.map((c) => c.name) });
  }
  const pill = {
    paid: ["Paid", "p-done"], part: ["Part paid", "p-warn"], overdue: ["Overdue", "p-over"],
    soon: ["Due soon", "p-warn"], upcoming: ["Due", "p-ok"], nodate: ["Due", "p-ok"],
  };
  const when = (b) => {
    if (b.status === "paid") return "Paid";
    if (!b.date) return "No due date yet";
    const n = dueIn(b.date);
    if (n < 0) return `${-n} day${n === -1 ? "" : "s"} overdue`;
    if (n === 0) return "Due today";
    return `Due in ${n} day${n === 1 ? "" : "s"}`;
  };

  return (
    <section className="panel card-bills">
      <div className="card-head">
        <h2>Bills &amp; due dates</h2>
        <span className="card-meta num">{money(total, sym)}</span>
      </div>
      {overdue.length > 0 && (
        <div className="alert" style={{ marginBottom: 10, padding: "9px 12px", fontSize: 13 }}>
          {overdue.length} overdue · {money(overdue.reduce((s, b) => s + b.due - b.paid, 0), sym)}
        </div>
      )}
      {!bills.length ? <div className="empty">No scheduled bills in {monthLabel(selMonth, { month: "long" })}.</div> : (
        <ul className="bill-list">
          {bills.map((b) => (
            <li key={b.id} className={b.status === "overdue" ? "is-overdue" : ""}>
              <span className={`bill-date ${b.status}`} title={b.date ? (b.inferred ? "Due day worked out from when you've paid it before — set it in Budgets" : "Due day you set") : "Set a due day in Budgets"}>
                <strong>{b.date ? Number(b.date.slice(8, 10)) : "—"}</strong>
                <span>{monthLabel(selMonth, { month: "short" })}{b.inferred ? "*" : ""}</span>
              </span>
              <span className="bill-main">
                <span className="bill-name">{b.name}</span>
                <span className="bill-sub">{when(b)}{b.status === "part" ? ` · ${money(b.paid, sym)} paid` : ""} · {b.section}</span>
              </span>
              <span className="bill-right">
                <span className="num bill-amt">{money(b.due, sym)}</span>
                <span className={`pill-s ${pill[b.status][1]}`}>{pill[b.status][0]}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {bills.length > 0 && <p className="card-note"><strong className="num">{money(left, sym)}</strong> still to pay. * = due day worked out from past payments; set exact days and card due dates in <button type="button" className="link-btn" style={{ padding: 0, minHeight: 0 }} onClick={onSetDue}>Budgets</button>.</p>}
      {ahead.length > 0 && (
        <p className="card-note">Coming up: {ahead.map((a, i) => (
          <span key={a.k}>{i ? "; " : ""}{monthLabel(a.k, { month: "short" })} — {a.n === 1 ? a.names[0] : `${a.n} yearly items`} <span className="num">{money(a.amt, sym)}</span></span>
        ))}.</p>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Budgets — YNAB-style "Available" bubbles                           */
/* ------------------------------------------------------------------ */
export function BudgetsCard({ fig, categories, catById, selMonth, sym, onPick, onEditBudgets }) {
  const [all, setAll] = useState(false);
  const orphan = fig.month.filter((e) => !catById[e.cat]).reduce((s, e) => s + e.amount, 0);
  const rows = fig.spendCats.map((c) => {
    const budget = budgetFor(c, selMonth), spent = fig.spentBy[c.id] || 0;
    const ratio = budget > 0 ? spent / budget : spent > 0 ? Infinity : 0;
    const isBill = BILL_SECTIONS.includes(c.section) && !NOT_A_BILL.test(c.name);
    let st = "ok";
    if (budget <= 0 && spent > 0) st = "over";
    else if (ratio > 1.02 || (!isBill && ratio > 1)) st = "over";
    else if (isBill && ratio >= 0.9) st = "done";
    else if (ratio >= 0.8) st = "warn";
    return { id: c.id, name: c.name, section: c.section, budget, spent, ratio, st };
  }).filter((r) => r.budget > 0 || r.spent > 0);
  if (orphan > 0) rows.push({ id: "__uncat__", name: "Uncategorised spend", section: "Suspense", budget: 0, spent: orphan, ratio: Infinity, st: "over" });
  const rank = { over: 0, warn: 1, ok: 2, done: 3 };
  const sorted = rows.slice().sort((a, b) => rank[a.st] - rank[b.st] || b.spent - a.spent);
  const shown = all ? sorted : sorted.slice(0, 9);
  const counts = rows.reduce((m, r) => ((m[r.st] = (m[r.st] || 0) + 1), m), {});

  return (
    <section className="panel card-budgets">
      <div className="card-head">
        <h2>Budgets</h2>
        <span className="legend">
          <span><i className="sw sw-ok" />On track</span>
          <span><i className="sw sw-warn" />80%+ used</span>
          <span><i className="sw sw-over" />Overspent{counts.over ? ` (${counts.over})` : ""}</span>
        </span>
      </div>
      <div className="bud-head"><span>Category · spent of budget</span><span>Available</span></div>
      {!rows.length && <div className="empty">Nothing budgeted or spent in {monthLabel(selMonth)}.</div>}
      {shown.map((r) => {
        const avail = r.budget - r.spent;
        const w = r.budget > 0 ? Math.min(100, (r.spent / r.budget) * 100) : 100;
        const label = r.st === "done" ? "Paid" : moneySigned(avail, sym);
        return (
          <button type="button" className="bud-row" key={r.id} onClick={() => onPick(r)} title={`Show ${r.name} entries`}>
            <span className="bud-main">
              <span className="bud-top">
                <span className="bud-name">{r.name} <span className="bud-sec">· {r.section}</span></span>
                <span className="bud-fig num">{money(r.spent, sym)}{r.budget > 0 ? ` / ${money(r.budget, sym)}` : " · no budget"}</span>
              </span>
              <span className="bud-track"><span className={`bud-fill f-${r.st}`} style={{ width: `${w}%` }} /></span>
            </span>
            <span className={`bud-pill num p-${r.st}`}>{label}</span>
          </button>
        );
      })}
      <div className="card-foot">
        {sorted.length > 9 && (
          <button type="button" className="link-btn" onClick={() => setAll((v) => !v)}>
            {all ? <><ChevronUp size={14} /> Show fewer</> : <><ChevronDown size={14} /> Show all {sorted.length} categories</>}
          </button>
        )}
        <button type="button" className="link-btn" onClick={onEditBudgets}>Edit budgets</button>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Where it went — share by section                                   */
/* ------------------------------------------------------------------ */
export function StructureCard({ fig, catById, sym }) {
  const by = {};
  fig.month.forEach((e) => { const s = catById[e.cat]?.section || "Uncategorised"; by[s] = (by[s] || 0) + e.amount; });
  const order = [...SECTIONS, "Uncategorised"].filter((s) => by[s] > 0).sort((a, b) => by[b] - by[a]);
  const total = order.reduce((s, k) => s + by[k], 0);
  let acc = 0;
  const stops = order.map((s) => { const a = acc; acc += (by[s] / total) * 100; return `${SECTION_COLORS[s] || "#999"} ${a.toFixed(2)}% ${acc.toFixed(2)}%`; });
  const aria = order.map((s) => `${s} ${Math.round((by[s] / total) * 100)} percent`).join(", ");
  return (
    <section className="panel card-structure">
      <div className="card-head"><h2>Where it went</h2></div>
      {!total ? <div className="empty">No spending logged yet.</div> : <>
        <div className="donut-wrap">
          <div className="donut" role="img" aria-label={`Spending by section: ${aria}`} style={{ background: `conic-gradient(${stops.join(", ")})` }}>
            <div className="donut-hole"><span>Spent</span><strong className="num">{money(total, sym)}</strong></div>
          </div>
        </div>
        <ul className="struct-list">
          {order.map((s) => (
            <li key={s}>
              <i className="sw" style={{ background: SECTION_COLORS[s] || "#999" }} />
              <span className="sl-name">{s}</span>
              <span className="num sl-amt">{money(by[s], sym)}</span>
              <span className="num sl-pct">{Math.round((by[s] / total) * 100)}%</span>
            </li>
          ))}
        </ul>
      </>}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Cash flow — last 6 months                                          */
/* ------------------------------------------------------------------ */
export function CashFlowCard({ expenses, credits, categories, cardDue, catById, selMonth, sym }) {
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const k = shiftMonth(selMonth, -i);
    const mi = monthIncome(credits, k);
    const out = expenses.filter((e) => e.date.slice(0, 7) === k && catById[e.cat]?.section !== NONSPEND_SECTION).reduce((s, e) => s + e.amount, 0);
    months.push({ k, inc: mi.total, has: mi.has, out });
  }
  const max = Math.max(...months.map((m) => Math.max(m.inc, m.out)), 1);

  // Money calendar for the selected month: income on top, bills by due date below.
  const N = daysIn(selMonth);
  const today = new Date();
  const isCur = selMonth === monthKey(today);
  const ins = credits.filter((c) => c.date.slice(0, 7) === selMonth && isIncome(c.kind));
  const bills = billsForMonth({ categories, expenses, credits, cardDue, selMonth }).filter((b) => b.date);
  const pos = (d) => `${((Number(d.slice(8, 10)) - 0.5) / N) * 100}%`;
  const stillDue = bills.filter((b) => b.status !== "paid");
  const stillAmt = stillDue.reduce((s, b) => s + Math.max(0, b.due - b.paid), 0);
  const next = stillDue.filter((b) => b.status !== "overdue").sort((a, b) => a.date.localeCompare(b.date))[0];
  const salaryDay = typicalDay(credits, "salary");
  const inSoFar = ins.reduce((s, c) => s + c.amount, 0);

  return (
    <section className="panel card-flow">
      <div className="card-head">
        <h2>Cash flow</h2>
        <span className="legend"><span><i className="sw sw-inc" />Income received</span><span><i className="sw sw-out" />Spent</span></span>
      </div>
      <div className="flow-bars">
        {months.map((m) => {
          const saved = m.inc - m.out;
          return (
            <div className={`flow-col${m.k === selMonth ? " sel" : ""}`} key={m.k}>
              <span className={`flow-saved num ${saved < 0 ? "t-red" : "t-teal"}`}>{m.has && m.out ? (saved < 0 ? "−" : "") + shortAmt(saved, sym) : "—"}</span>
              <div className="flow-pair">
                {m.has
                  ? <span className="flow-bar inc" style={{ height: `${(m.inc / max) * 120}px` }} title={`Income ${money(m.inc, sym)}`} />
                  : <span className="flow-none" title="No bank statements imported for this month">no<br />stmt</span>}
                <span className="flow-bar out" style={{ height: `${(m.out / max) * 120}px` }} title={`Spent ${money(m.out, sym)}`} />
              </div>
              <span className="flow-m">{monthLabel(m.k, { month: "short" })}</span>
            </div>
          );
        })}
      </div>

      <div className="card-head" style={{ marginTop: 18, marginBottom: 0 }}>
        <h2 style={{ fontSize: 14 }}>Money calendar · {monthLabel(selMonth, { month: "long" })}</h2>
      </div>
      <div className="tl" role="img" aria-label={`Income on ${ins.map((c) => c.date.slice(8, 10)).join(", ") || "no days yet"}; bills due on ${bills.map((b) => `${b.date.slice(8, 10)} ${b.name}`).join(", ")}`}>
        <span className="tl-axis" />
        {isCur && <span className="tl-today" style={{ left: `${((today.getDate() - 0.5) / N) * 100}%` }} title="Today" />}
        {ins.map((c) => <span key={c.id} className="tl-mark in" style={{ left: pos(c.date) }} title={`${c.date.slice(8, 10)}: +${money(c.amount, sym)} ${CREDIT_KINDS[c.kind].label}`} />)}
        {bills.map((b) => <span key={b.id} className={`tl-mark out ${b.status}`} style={{ left: pos(b.date) }} title={`${b.date.slice(8, 10)}: ${b.name} ${money(b.due, sym)} · ${b.status}`} />)}
        {[1, 8, 15, 22, N].map((d) => <span key={d} className="tl-lbl" style={{ left: `${((d - 0.5) / N) * 100}%` }}>{d}</span>)}
      </div>
      <div className="tl-legend">
        <span><i style={{ background: "var(--teal)" }} />Income in</span>
        <span><i style={{ background: "var(--red)" }} />Overdue</span>
        <span><i style={{ background: "var(--amber)" }} />Due in 7 days</span>
        <span><i style={{ background: "var(--ink)" }} />Due later</span>
        <span><i style={{ background: "#B9C1C6" }} />Paid</span>
      </div>
      <p className="card-note">
        {inSoFar ? <>Income in so far: <strong className="num">{money(inSoFar, sym)}</strong>. </> : <>No income recorded for this month yet. </>}
        {stillDue.length ? <>Still to go out: <strong className="num">{money(stillAmt, sym)}</strong> across {stillDue.length} bill{stillDue.length === 1 ? "" : "s"}{next ? <> — next is {next.name} on the {ordinal(Number(next.date.slice(8, 10)))}</> : null}. </> : <>All dated bills are paid. </>}
        {salaryDay ? <>Salary usually lands around the {ordinal(salaryDay)}.</> : null}
      </p>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Top payees                                                         */
/* ------------------------------------------------------------------ */
export function PayeesCard({ fig, catById, sym }) {
  const by = new Map();
  fig.month.forEach((e) => {
    // scheduled bills (EMI, maintenance, premiums) aren't "payees" worth watching
    const c = catById[e.cat];
    if (c && BILL_SECTIONS.includes(c.section) && !NOT_A_BILL.test(c.name)) return;
    const k = merchantKey(e.note || "");
    if (!k) return;
    const r = by.get(k) || { k, amt: 0, n: 0, cats: {} };
    r.amt += e.amount; r.n += 1;
    const cn = catById[e.cat]?.name || "Suspense";
    r.cats[cn] = (r.cats[cn] || 0) + 1;
    by.set(k, r);
  });
  const top = [...by.values()].sort((a, b) => b.amt - a.amt).slice(0, 6);
  return (
    <section className="panel card-payees">
      <div className="card-head"><h2>Top payees</h2><span className="card-meta">day-to-day spend</span></div>
      {!top.length ? <div className="empty">Payees show up once entries have notes or are imported.</div> : (
        <ol className="payee-list">
          {top.map((p) => {
            const name = titleCase(p.k);
            const cat = Object.entries(p.cats).sort((a, b) => b[1] - a[1])[0][0];
            return (
              <li key={p.k}>
                <span className="payee-ini" aria-hidden="true">{name.split(" ").map((w) => w[0]).join("").slice(0, 2)}</span>
                <span className="payee-main"><span className="payee-name">{name}</span><span className="payee-sub">{cat} · {p.n} {p.n === 1 ? "entry" : "entries"}</span></span>
                <span className="num payee-amt">{money(p.amt, sym)}</span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Set aside for yearly bills                                         */
/* ------------------------------------------------------------------ */
export function SetAsideCard({ categories, selMonth, sym }) {
  const items = [];
  for (const c of categories) {
    if (!YEARLY_SECTIONS.includes(c.section)) continue;
    for (let i = 1; i <= 12; i++) {
      const k = shiftMonth(selMonth, i);
      const amt = budgetFor(c, k);
      if (amt > 0) { items.push({ id: c.id, name: c.name, k, amt, months: i, per: amt / i }); break; }
    }
  }
  items.sort((a, b) => b.per - a.per);
  const perMonth = items.reduce((s, x) => s + x.per, 0);
  const top = items.slice(0, 4);
  return (
    <section className="panel card-setaside">
      <div className="card-head"><h2>Set aside for yearly bills</h2></div>
      {!items.length ? <div className="empty">No yearly bills ahead in this financial year.</div> : <>
        <p className="card-note" style={{ marginTop: 0 }}>Put <strong className="num">{money(perMonth, sym)}</strong> a month aside to cover the {items.length} yearly payment{items.length === 1 ? "" : "s"} ahead without a spike.</p>
        {top.map((x) => (
          <div className="sa-row" key={x.id}>
            <div className="sa-top">
              <span className="sa-name">{x.name}</span>
              <span className="num sa-amt">{money(x.amt, sym)}</span>
            </div>
            <span className="sa-track"><span style={{ width: `${Math.max(6, 100 - (x.months / 12) * 100)}%` }} /></span>
            <span className="sa-sub">Due {monthLabel(x.k, { month: "short", year: "numeric" })} · <span className="num">{money(x.per, sym)}</span>/month for {x.months} month{x.months === 1 ? "" : "s"}</span>
          </div>
        ))}
      </>}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Quick add — amount first                                           */
/* ------------------------------------------------------------------ */
export function QuickAdd({ categories, expenses, catPersonMap, defaultBank, sym, onSave, onClose }) {
  const [amt, setAmt] = useState("");
  const [cat, setCat] = useState("");
  const [people, setPeople] = useState([]);
  const [bank, setBank] = useState(defaultBank || "");
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState("");
  const [flash, setFlash] = useState("");
  const amtRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    // on phones the on-screen keypad is the input — don't summon the system keyboard over it
    const narrow = window.matchMedia && window.matchMedia("(max-width: 820px)").matches;
    if (!narrow && amtRef.current) amtRef.current.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // most-used categories over the last 90 days, by manual + imported entries
  const frequent = useMemo(() => {
    const since = new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10);
    const n = {};
    expenses.forEach((e) => { if (e.date >= since && e.cat !== SUSPENSE_ID) n[e.cat] = (n[e.cat] || 0) + 1; });
    const ok = new Set(categories.filter((c) => c.section !== NONSPEND_SECTION).map((c) => c.id));
    return Object.entries(n).filter(([id]) => ok.has(id)).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id]) => categories.find((c) => c.id === id));
  }, [expenses, categories]);

  const pickCat = (id) => { setCat(id); const saved = catPersonMap[id]; setPeople(saved ? [...saved] : []); };
  const press = (t) => setAmt((a) => {
    if (t === "del") return a.slice(0, -1);
    if (t === "." && a.includes(".")) return a;
    const next = (a === "0" && t !== "." ? "" : a) + t;
    return next.length > 9 ? a : next;
  });
  const value = parseFloat(amt) || 0;
  const can = value > 0 && cat && date;
  const save = (again) => {
    if (!can) return;
    onSave({ cat, amount: value, date, note: note.trim(), person: people, bank });
    const nm = categories.find((c) => c.id === cat)?.name;
    if (again) { setAmt(""); setNote(""); setFlash(`Saved ${money(value, sym)} to ${nm}`); setTimeout(() => setFlash(""), 2000); }
    else onClose();
  };
  const catName = categories.find((c) => c.id === cat)?.name;

  return (
    <div className="qa-scrim" onClick={onClose}>
      <div className="qa-sheet" role="dialog" aria-modal="true" aria-label="Add expense" onClick={(e) => e.stopPropagation()}>
        <div className="qa-head">
          <h2>Add expense</h2>
          <button className="icon-btn" aria-label="Close" onClick={onClose}><X size={18} /></button>
        </div>
        <label className="qa-amount">
          <span className="qa-amt-label">Amount</span>
          <span className="qa-amt-row">
            <span className="qa-cur">{sym.trim()}</span>
            <input ref={amtRef} className="num" inputMode="decimal" placeholder="0" value={amt}
              onChange={(e) => setAmt(e.target.value.replace(/[^0-9.]/g, ""))}
              onKeyDown={(e) => e.key === "Enter" && save(true)} aria-label="Amount" />
          </span>
        </label>

        <div className="qa-block">
          <span className="qa-label">Category · most used first</span>
          <div className="qa-chips">
            {frequent.map((c) => (
              <button type="button" key={c.id} className={`chip${cat === c.id ? " on" : ""}`} onClick={() => pickCat(c.id)}>{c.name}</button>
            ))}
            <select className={`chip chip-select${cat && !frequent.some((c) => c.id === cat) ? " on" : ""}`} value={frequent.some((c) => c.id === cat) ? "" : cat}
              onChange={(e) => e.target.value && pickCat(e.target.value)} aria-label="All categories">
              <option value="">More…</option>
              {SECTIONS.map((sec) => {
                const opts = categories.filter((c) => c.section === sec);
                return opts.length ? <optgroup key={sec} label={sec}>{opts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup> : null;
              })}
            </select>
          </div>
        </div>

        <div className="qa-row">
          <div className="qa-people" role="group" aria-label="For">
            <span className="qa-label">For</span>
            {["Sid", "Manali", "Saryu"].map((p) => (
              <button type="button" key={p} aria-pressed={people.includes(p)} className={`pchip${people.includes(p) ? " on" : ""}`}
                onClick={() => setPeople((x) => x.includes(p) ? x.filter((y) => y !== p) : [...x, p])}>{p}</button>
            ))}
          </div>
          <label className="qa-field"><span className="qa-label">Paid via</span>
            <select value={bank} onChange={(e) => setBank(e.target.value)}>
              <option value="">— account —</option>
              <BankOptions />
            </select>
          </label>
          <label className="qa-field"><span className="qa-label">Date</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
        </div>
        <label className="qa-field qa-note"><span className="qa-label">Note (optional)</span>
          <input type="text" value={note} placeholder="e.g. DMart, vegetables" onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save(true)} />
        </label>

        <div className="qa-keypad" aria-label="Keypad">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "del"].map((t) => (
            <button type="button" key={t} className="key num" aria-label={t === "del" ? "Delete digit" : t} onClick={() => press(t)}>
              {t === "del" ? <Delete size={20} /> : t}
            </button>
          ))}
        </div>

        {flash && <div className="qa-flash" role="status"><Check size={14} /> {flash}</div>}
        <div className="qa-actions">
          <button type="button" className="btn-ghost" disabled={!can} onClick={() => save(true)}>Save &amp; add another</button>
          <button type="button" className="btn-add" disabled={!can} onClick={() => save(false)}>
            <Check size={16} /> {can ? `Save ${money(value, sym)} · ${catName}` : value ? "Pick a category" : "Enter an amount"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Version history                                                    */
/* ------------------------------------------------------------------ */
const fmtWhen = (iso) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const dayOf = (iso) => new Date(iso).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "long", year: "numeric" });

export function HistoryView({ sym }) {
  const [state, setState] = useState({ loading: true, events: [], snapshots: [], err: "" });
  const [open, setOpen] = useState({});
  const [busy, setBusy] = useState("");

  const load = async () => {
    setState((s) => ({ ...s, loading: true, err: "" }));
    try {
      await store.flush();
      const j = await api("/api/history");
      setState({ loading: false, events: j.events || [], snapshots: j.snapshots || [], err: "" });
    } catch (e) { setState((s) => ({ ...s, loading: false, err: e.message || "Couldn't load history." })); }
  };
  useEffect(() => { load(); }, []);

  const download = async (s) => {
    setBusy(s.id);
    try {
      const j = await api(`/api/history?id=${encodeURIComponent(s.id)}`);
      const blob = new Blob([JSON.stringify(j.data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `manali-ledger-version-${s.at.slice(0, 16).replace(/[:T]/g, "-")}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (e) { alert(e.message); }
    setBusy("");
  };
  const restore = async (s) => {
    if (!window.confirm(`Restore the ledger to how it was on ${fmtWhen(s.at)}?\n\nEverything entered after that will be replaced. The current state is saved as a version first, so you can undo this.`)) return;
    setBusy(s.id);
    try {
      await store.flush();
      await api("/api/history", { method: "POST", body: JSON.stringify({ restore: s.id }) });
      window.dispatchEvent(new CustomEvent("ledger:reload"));
    } catch (e) { alert(e.message); setBusy(""); }
  };

  const groups = [];
  state.events.forEach((ev) => {
    const d = dayOf(ev.at);
    if (!groups.length || groups[groups.length - 1].d !== d) groups.push({ d, items: [] });
    groups[groups.length - 1].items.push(ev);
  });

  return (
    <div className="hist-wrap">
      <section className="panel">
        <div className="card-head">
          <h2>Change history</h2>
          <button className="link-btn" onClick={load}><RotateCcw size={13} /> Refresh</button>
        </div>
        <p className="card-note" style={{ marginTop: 0 }}>Every save is recorded here by the server — what was added, removed or edited, and from which kind of device.</p>
        {state.loading && <div className="empty">Loading…</div>}
        {state.err && <div className="empty t-red">{state.err}</div>}
        {!state.loading && !state.err && !state.events.length && <div className="empty">No changes recorded yet. History starts with the next change you make.</div>}
        {groups.map((g) => (
          <div className="hist-day" key={g.d}>
            <div className="hist-dayname">{g.d}</div>
            {g.items.map((ev, i) => {
              const key = ev.at + i;
              const isOpen = open[key];
              return (
                <div className="hist-ev" key={key}>
                  <button type="button" className="hist-ev-top" onClick={() => setOpen((o) => ({ ...o, [key]: !o[key] }))} aria-expanded={!!isOpen}>
                    <span className="hist-time num"><Clock size={12} /> {new Date(ev.at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}</span>
                    <span className="hist-chips">
                      {ev.reason === "restore" && <span className="pill-s p-warn">Restored</span>}
                      {ev.added > 0 && <span className="pill-s p-ok">+{ev.added} added · {money(ev.addedAmt, sym)}</span>}
                      {ev.removed > 0 && <span className="pill-s p-over">−{ev.removed} removed · {money(ev.removedAmt, sym)}</span>}
                      {ev.edited > 0 && <span className="pill-s p-done">{ev.edited} edited</span>}
                      {(ev.other || []).map((o) => <span key={o} className="pill-s p-plain">{o} changed</span>)}
                    </span>
                    <span className="hist-dev">{ev.device}</span>
                    {ev.sample && ev.sample.length > 0 && (isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}
                  </button>
                  {isOpen && ev.sample && (
                    <ul className="hist-sample">
                      {ev.sample.map((s, j) => (
                        <li key={j}>
                          <span className={`hs-t hs-${s.t === "+" ? "add" : s.t === "-" ? "del" : "ed"}`}>{s.t === "~" ? "edit" : s.t === "+" ? "add" : "del"}</span>
                          <span className="num">{s.date}</span>
                          <span>{s.cat}</span>
                          <span className="hs-note">{s.note}{s.was ? ` (was ${s.was})` : ""}</span>
                          <span className="num">{money(s.amount, sym)}</span>
                        </li>
                      ))}
                      {ev.added + ev.removed + ev.edited > ev.sample.length && <li className="hs-more">…and {ev.added + ev.removed + ev.edited - ev.sample.length} more</li>}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </section>

      <section className="panel">
        <div className="card-head"><h2><HistoryIcon size={15} style={{ verticalAlign: "-2px" }} /> Saved versions</h2></div>
        <p className="card-note" style={{ marginTop: 0 }}>A full copy of the ledger is kept at least every 30 minutes of editing, and always before an import, a big delete, a budget change or a restore. The last 60 are kept.</p>
        {!state.loading && !state.snapshots.length && <div className="empty">No versions yet — the first is saved with your next change.</div>}
        <ul className="snap-list">
          {state.snapshots.map((s) => (
            <li key={s.id}>
              <span className="snap-main">
                <span className="snap-when">{fmtWhen(s.at)}</span>
                <span className="snap-sub">{s.note} · {s.expenses} entries</span>
              </span>
              <button className="btn-ghost sm" disabled={!!busy} onClick={() => download(s)}><Download size={13} /> Download</button>
              <button className="btn-ghost sm" disabled={!!busy} onClick={() => restore(s)}><RotateCcw size={13} /> {busy === s.id ? "Working…" : "Restore"}</button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Styles for the cards above                                         */
/* ------------------------------------------------------------------ */
export const dashCss = `
.ledger-root{max-width:1320px; padding-bottom:110px;}
.t-red{color:var(--red)!important;} .t-teal{color:var(--teal)!important;}
.mast2{display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:12px 16px; margin-bottom:18px;}
.navtabs{display:flex; flex-wrap:wrap; gap:2px; background:var(--surface); border:1px solid var(--hairline); border-radius:12px; padding:4px;}
.navtabs button{border:0; background:transparent; border-radius:9px; padding:9px 13px; min-height:38px; font:500 13px Inter,sans-serif; color:var(--ink); cursor:pointer; display:inline-flex; align-items:center; gap:6px;}
.navtabs button:hover{background:var(--bg);}
.navtabs button.on{background:var(--ink); color:#fff; font-weight:600;}
.mast-actions{display:flex; flex-wrap:wrap; align-items:center; gap:8px;}
.mast-actions .btn-ghost{min-height:40px;}
.btn-dark{display:inline-flex; align-items:center; gap:7px; background:var(--ink); color:#fff; border:0; border-radius:11px; padding:9px 14px; min-height:40px; font:600 13px Inter,sans-serif; cursor:pointer;}
.btn-logout{color:var(--red)!important;}
.btn-logout:hover{border-color:var(--red)!important;}
.stmt-badge strong{font-family:'JetBrains Mono',monospace;}
.stmt-badge.done svg{color:var(--teal);} .stmt-badge.todo svg{color:var(--amber);}
.sync{font-size:11.5px; color:var(--muted); display:inline-flex; align-items:center; gap:5px; white-space:nowrap;}
.sync.error{color:var(--red); font-weight:600;}
.stmt-pop{margin:-6px 0 16px;}

.kpis{display:flex; flex-wrap:wrap; gap:12px; margin-bottom:16px;}
.kpi{flex:1 1 210px; background:var(--surface); border:1px solid var(--hairline); border-radius:16px; padding:16px 18px; display:flex; flex-direction:column; gap:5px;}
.kpi-label{font-size:11.5px; font-weight:600; letter-spacing:.06em; text-transform:uppercase; color:var(--muted);}
.kpi-value{font-size:26px; font-weight:600;}
.kpi-sub{font-size:12.5px; color:var(--muted);}
.kpi-value.t-pending{font-family:Inter,sans-serif; font-size:17px; color:var(--muted); font-weight:600; padding:6px 0 3px;}

.cards{display:flex; flex-wrap:wrap; gap:16px; margin-bottom:16px; align-items:flex-start;}
.cards > .panel{border-radius:16px; padding:18px 20px; min-width:0;}
.card-pace,.card-budgets{flex:2 1 560px;}
.card-bills,.card-structure{flex:1 1 320px;}
.card-flow{flex:1.3 1 420px;} .card-payees,.card-setaside{flex:1 1 300px;}
.card-head{display:flex; flex-wrap:wrap; justify-content:space-between; align-items:baseline; gap:8px; margin-bottom:12px;}
.card-head h2{font-family:'Space Grotesk',sans-serif; font-size:16px; font-weight:600; margin:0;}
.card-meta{font-size:12.5px; color:var(--muted);}
.card-note{font-size:12px; color:var(--muted); margin:10px 0 0; line-height:1.5;}
.card-foot{display:flex; justify-content:space-between; gap:10px; padding-top:10px;}
.link-btn{border:0; background:none; color:var(--teal); font:600 13px Inter,sans-serif; cursor:pointer; display:inline-flex; align-items:center; gap:4px; padding:6px 0; min-height:32px;}
.link-btn:hover{text-decoration:underline;}
.legend{display:flex; flex-wrap:wrap; gap:12px; font-size:11.5px; color:var(--muted);}
.legend span{display:inline-flex; align-items:center; gap:5px;}
.sw{display:inline-block; width:10px; height:10px; border-radius:3px; flex:none;}
.sw-ok{background:var(--teal);} .sw-warn{background:var(--amber);} .sw-over{background:var(--red);}
.sw-inc{background:#A9D3C9;} .sw-out{background:var(--ink);}

.pace-figs{display:flex; flex-wrap:wrap; gap:28px; margin-bottom:6px;}
.pace-figs > div{display:flex; flex-direction:column; gap:2px;}
.pf-label{font-size:12px; color:var(--muted);}
.pf-value{font-size:22px; font-weight:600;}
.pf-sub{font-size:12px; color:var(--muted); font-weight:500;}
.pace-svg{width:100%; height:auto; display:block;}
.svg-lbl{font:11px Inter,sans-serif; fill:var(--muted);}
.svg-val{font:600 12px 'JetBrains Mono',monospace; fill:var(--teal);}

.bill-list{list-style:none; margin:0; padding:0; max-height:330px; overflow-y:auto;}
.bill-list li{display:flex; align-items:center; gap:12px; padding:9px 0; border-bottom:1px solid var(--hairline);}
.bill-main{flex:1; min-width:0; display:flex; flex-direction:column;}
.bill-name{font-size:13.5px; font-weight:500;}
.bill-sub{font-size:11.5px; color:var(--muted);}
.bill-right{display:flex; flex-direction:column; align-items:flex-end; gap:3px;}
.bill-amt{font-size:13.5px; font-weight:600;}
.pill-s{font-size:11px; font-weight:600; padding:2px 8px; border-radius:6px; white-space:nowrap;}
.p-ok{background:var(--teal-soft); color:var(--teal);}
.p-warn{background:#FBEEDC; color:var(--amber);}
.p-over{background:var(--red-soft); color:var(--red);}
.p-done{background:#EEF1F2; color:#4B555C;}
.p-plain{background:var(--bg); color:var(--muted);}

.bud-head{display:flex; justify-content:space-between; font-size:11px; font-weight:600; letter-spacing:.06em; text-transform:uppercase; color:var(--muted); padding:6px 0; border-bottom:1px solid var(--hairline);}
.bud-row{width:100%; display:grid; grid-template-columns:minmax(0,1fr) auto; gap:14px; align-items:center; padding:9px 4px; border:0; border-bottom:1px solid var(--hairline); background:transparent; text-align:left; cursor:pointer; font:inherit; color:inherit; border-radius:0;}
.bud-row:hover{background:#F7F9F9;}
.bud-main{display:flex; flex-direction:column; gap:6px; min-width:0;}
.bud-top{display:flex; justify-content:space-between; gap:10px; font-size:13.5px;}
.bud-name{font-weight:500; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
.bud-sec{font-size:12px; color:var(--muted); font-weight:400;}
.bud-fig{font-size:12.5px; color:var(--muted); white-space:nowrap;}
.bud-track{height:6px; border-radius:3px; background:#EEF1F2; overflow:hidden; display:block;}
.bud-fill{display:block; height:6px; border-radius:3px;}
.f-ok{background:var(--teal);} .f-warn{background:var(--amber);} .f-over{background:var(--red);} .f-done{background:#9AA3AB;}
.bud-pill{min-width:92px; text-align:center; font-size:12.5px; font-weight:600; padding:5px 10px; border-radius:20px;}

.donut-wrap{display:flex; justify-content:center; margin:4px 0 16px;}
.donut{width:190px; height:190px; border-radius:50%; display:flex; align-items:center; justify-content:center;}
.donut-hole{width:118px; height:118px; border-radius:50%; background:var(--surface); display:flex; flex-direction:column; align-items:center; justify-content:center; gap:2px;}
.donut-hole span{font-size:12px; color:var(--muted);} .donut-hole strong{font-size:17px;}
.struct-list{list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:8px;}
.struct-list li{display:flex; align-items:center; gap:10px; font-size:13.5px;}
.sl-name{flex:1;} .sl-amt{font-size:12.5px; font-weight:600;} .sl-pct{font-size:12px; color:var(--muted); width:36px; text-align:right;}

.flow-bars{display:flex; justify-content:space-between; align-items:flex-end; gap:8px;}
.flow-col{flex:1; display:flex; flex-direction:column; align-items:center; gap:6px;}
.flow-saved{font-size:11px; font-weight:600;}
.flow-pair{display:flex; align-items:flex-end; justify-content:center; gap:4px; height:124px; width:100%; border-bottom:1px solid var(--hairline);}
.flow-bar{width:16px; border-radius:4px 4px 0 0; display:block;}
.flow-bar.inc{background:#A9D3C9;} .flow-bar.out{background:var(--ink);} .flow-bar.out.over{background:var(--red);}
.flow-m{font-size:12px; color:var(--muted);}
.flow-col.sel .flow-m{color:var(--ink); font-weight:600;}

.payee-list{list-style:none; margin:0; padding:0;}
.payee-list li{display:flex; align-items:center; gap:12px; padding:8px 0; border-bottom:1px solid var(--hairline);}
.payee-ini{width:34px; height:34px; flex:none; border-radius:10px; background:var(--teal-soft); color:var(--teal); display:flex; align-items:center; justify-content:center; font:700 13px 'Space Grotesk',sans-serif;}
.payee-main{flex:1; min-width:0; display:flex; flex-direction:column;}
.payee-name{font-size:13.5px; font-weight:500; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
.payee-sub{font-size:11.5px; color:var(--muted);}
.payee-amt{font-size:13.5px; font-weight:600;}

.sa-row{display:flex; flex-direction:column; gap:5px; margin-top:12px;}
.sa-top{display:flex; justify-content:space-between; gap:8px; font-size:13.5px;}
.sa-name{font-weight:500;} .sa-amt{font-size:12.5px; color:var(--muted);}
.sa-track{height:8px; border-radius:4px; background:#EEF1F2; overflow:hidden; display:block;}
.sa-track span{display:block; height:8px; border-radius:4px; background:#3D5A80;}
.sa-sub{font-size:12px; color:var(--muted);}

.fab{position:fixed; right:28px; bottom:28px; z-index:40; height:58px; padding:0 24px 0 20px; border-radius:29px; border:0; background:var(--teal); color:#fff; display:flex; align-items:center; gap:9px; font:600 15px Inter,sans-serif; cursor:pointer; box-shadow:0 8px 24px rgba(14,124,107,.35);}
.fab:hover{background:#0A6A5B;}

.qa-scrim{position:fixed; inset:0; background:rgba(23,27,30,.42); z-index:60; display:flex; align-items:center; justify-content:center; padding:16px;}
.qa-sheet{width:100%; max-width:520px; max-height:calc(100vh - 32px); overflow-y:auto; background:var(--bg); border-radius:20px; padding:18px; display:flex; flex-direction:column; gap:14px; box-shadow:0 20px 60px rgba(0,0,0,.25);}
.qa-head{display:flex; justify-content:space-between; align-items:center;}
.qa-head h2{font-family:'Space Grotesk',sans-serif; font-size:17px; margin:0;}
.qa-amount{display:flex; flex-direction:column; align-items:center; gap:2px;}
.qa-amt-label,.qa-label{font-size:11.5px; font-weight:600; letter-spacing:.04em; color:var(--muted);}
.qa-amt-row{display:flex; align-items:baseline; justify-content:center; gap:4px;}
.qa-cur{font:600 30px 'JetBrains Mono',monospace; color:var(--muted);}
.qa-amt-row input{width:240px; border:0; background:transparent; font-size:46px; font-weight:600; text-align:center; color:var(--ink); outline:none; padding:0;}
.qa-amt-row input::placeholder{color:var(--faint);}
.qa-block{display:flex; flex-direction:column; gap:8px;}
.qa-chips{display:flex; flex-wrap:wrap; gap:8px;}
.chip{min-height:40px; padding:0 14px; border-radius:20px; border:1px solid var(--hairline); background:var(--surface); color:var(--ink); font:500 13.5px Inter,sans-serif; cursor:pointer;}
.chip.on{background:var(--ink); color:#fff; border-color:var(--ink);}
.chip-select{appearance:auto; padding-right:8px;}
.qa-row{display:flex; flex-wrap:wrap; gap:12px; align-items:flex-end;}
.qa-people{display:flex; align-items:center; gap:6px; flex-wrap:wrap;}
.pchip{min-height:38px; padding:0 12px; border-radius:10px; border:1px solid var(--hairline); background:var(--surface); color:#4B555C; font:600 13px Inter,sans-serif; cursor:pointer;}
.pchip.on{background:var(--teal-soft); color:var(--teal); border-color:var(--teal);}
.qa-field{display:flex; flex-direction:column; gap:4px; flex:1 1 140px;}
.qa-field select,.qa-field input{height:40px; border:1px solid var(--hairline); border-radius:10px; background:var(--surface); padding:0 10px; font:500 13.5px Inter,sans-serif; color:var(--ink);}
.qa-note{flex:none;}
.qa-keypad{display:none; grid-template-columns:repeat(3,minmax(0,1fr)); gap:8px;}
.key{height:54px; border:0; border-radius:14px; background:var(--surface); font-size:21px; font-weight:600; color:var(--ink); cursor:pointer; display:flex; align-items:center; justify-content:center;}
.key:active{background:var(--hairline);}
.qa-flash{display:flex; align-items:center; gap:6px; font-size:13px; color:var(--teal); font-weight:600;}
.qa-actions{display:flex; gap:10px; flex-wrap:wrap;}
.qa-actions .btn-add{flex:1; min-height:50px; justify-content:center; font-size:15px;}
.qa-actions .btn-ghost{min-height:50px;}
.qa-actions button[disabled]{opacity:.45; cursor:not-allowed;}

.hist-wrap{display:flex; flex-direction:column; gap:16px;}
.hist-day{margin-top:14px;}
.hist-dayname{font-size:12px; font-weight:600; letter-spacing:.06em; text-transform:uppercase; color:var(--muted); padding-bottom:6px; border-bottom:1px solid var(--hairline);}
.hist-ev{border-bottom:1px solid var(--hairline);}
.hist-ev-top{width:100%; display:flex; align-items:center; gap:12px; flex-wrap:wrap; padding:10px 2px; border:0; background:transparent; cursor:pointer; text-align:left; font:inherit; color:inherit;}
.hist-time{font-size:12px; color:var(--muted); display:inline-flex; align-items:center; gap:4px; width:76px;}
.hist-chips{flex:1; display:flex; flex-wrap:wrap; gap:6px;}
.hist-dev{font-size:12px; color:var(--muted);}
.hist-sample{list-style:none; margin:0 0 10px; padding:8px 12px; background:var(--bg); border-radius:10px; display:flex; flex-direction:column; gap:6px;}
.hist-sample li{display:grid; grid-template-columns:44px 90px 140px minmax(0,1fr) auto; gap:10px; font-size:12.5px; align-items:center;}
.hs-note{overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--muted);}
.hs-t{font-size:10.5px; font-weight:700; text-transform:uppercase; border-radius:5px; padding:1px 6px; text-align:center;}
.hs-add{background:var(--teal-soft); color:var(--teal);} .hs-del{background:var(--red-soft); color:var(--red);} .hs-ed{background:#EEF1F2; color:#4B555C;}
.hs-more{display:block!important; color:var(--muted);}
.snap-list{list-style:none; margin:0; padding:0;}
.snap-list li{display:flex; align-items:center; gap:10px; flex-wrap:wrap; padding:10px 0; border-bottom:1px solid var(--hairline);}
.snap-main{flex:1; min-width:180px; display:flex; flex-direction:column;}
.snap-when{font-size:13.5px; font-weight:500;}
.snap-sub{font-size:12px; color:var(--muted);}

@media (max-width:820px){
  .navtabs{order:3; width:100%; max-width:100%; min-width:0; overflow-x:auto; flex-wrap:nowrap;}
  .navtabs button{flex:none;}
  .kpi-value{font-size:22px;}
  .fab{right:16px; bottom:16px; height:56px; padding:0 20px 0 16px;}
  .qa-scrim{align-items:flex-end; padding:0;}
  .qa-sheet{border-radius:20px 20px 0 0; max-height:94vh;}
  .qa-keypad{display:grid;}
  .qa-amt-row input{font-size:40px;}
  .hist-sample li{grid-template-columns:40px 1fr auto; }
  .hist-sample li > span:nth-child(3), .hist-sample li > .hs-note{display:none;}
}
@media (max-width:480px){
  .ledger-root{padding:12px 12px 100px;}
  .entries li{grid-template-columns:48px minmax(0,1fr) auto 28px 28px!important;}
  .entries li .en-bank{display:none;}
  .en-cat{overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
  .mast-actions .btn-ghost,.mast-actions .btn-dark{padding:8px 11px;}
  .fab span.fab-label{display:none;}
  .fab{width:58px; padding:0; justify-content:center;}
}
`;
