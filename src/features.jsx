import React, { useState, useMemo, useEffect, useRef } from "react";
import { X, Plus, Trash2, Send, Sparkles, TriangleAlert, Check } from "lucide-react";
import {
  money, moneySigned, monthLabel, shiftMonth, budgetFor, uid, BANKS, SECTIONS, NONSPEND_SECTION, SUSPENSE_ID, api, store,
} from "../ExpenseLedger.jsx";
import { merchantKey } from "../api/_lib/categorize.js";
import {
  periodOf, currentPeriod, periodDates, periodLabel, dayIndex, todayIso, shortDate, getMonthStart,
} from "./period.js";
import { billsForMonth, isIncome, CREDIT_KINDS, isBillCat } from "./income.jsx";

const titleCase = (s) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
const bankLabel = (k) => BANKS.find((b) => b.key === k)?.label || k || "—";
const isSpend = (e, catById) => catById[e.cat]?.section !== NONSPEND_SECTION;

/* ------------------------------------------------------------------ */
/*  Drill-down: one category, merchant or tag across every month       */
/* ------------------------------------------------------------------ */
export function DrillDown({ filter, allExp, catById, sym, onClose }) {
  useEffect(() => {
    const k = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  const match = (e) => filter.type === "cat" ? (filter.value === "__uncat__" ? !catById[e.cat] : e.cat === filter.value)
    : filter.type === "merchant" ? merchantKey(e.note || "") === filter.value
    : (e.tags || []).includes(filter.value);
  const rows = allExp.filter(match).sort((a, b) => b.date.localeCompare(a.date));
  const total = rows.reduce((s, e) => s + e.amount, 0);
  const cur = currentPeriod();
  const months = []; for (let i = 11; i >= 0; i--) months.push(shiftMonth(cur, -i));
  const per = months.map((k) => ({ k, v: rows.filter((e) => periodOf(e.date) === k).reduce((s, e) => s + e.amount, 0) }));
  const max = Math.max(...per.map((p) => p.v), 1);
  const active = per.filter((p) => p.v > 0);
  const avg = active.length ? active.reduce((s, p) => s + p.v, 0) / active.length : 0;
  const byCat = {};
  if (filter.type !== "cat") rows.forEach((e) => { const n = catById[e.cat]?.name || "Uncategorised"; byCat[n] = (byCat[n] || 0) + e.amount; });
  const groups = [];
  rows.slice(0, 300).forEach((e) => { const k = periodOf(e.date); if (!groups.length || groups[groups.length - 1].k !== k) groups.push({ k, items: [] }); groups[groups.length - 1].items.push(e); });

  return (
    <div className="qa-scrim" onClick={onClose}>
      <div className="qa-sheet dd-sheet" role="dialog" aria-modal="true" aria-label={filter.label} onClick={(e) => e.stopPropagation()}>
        <div className="qa-head">
          <h2>{filter.type === "tag" ? "#" : ""}{filter.label}</h2>
          <button className="icon-btn" aria-label="Close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="mi-kpis">
          <div><span className="pf-label">All time</span><span className="pf-value num">{money(total, sym)}</span></div>
          <div><span className="pf-label">Entries</span><span className="pf-value num">{rows.length}</span></div>
          <div><span className="pf-label">Average per active month</span><span className="pf-value num">{money(avg, sym)}</span></div>
          {rows.length > 0 && <div><span className="pf-label">First → last</span><span className="pf-value num" style={{ fontSize: 15 }}>{shortDate(rows[rows.length - 1].date)} → {shortDate(rows[0].date)}</span></div>}
        </div>
        <div className="dd-bars" aria-label="Last 12 months">
          {per.map((p) => (
            <div className="dd-col" key={p.k} title={`${periodLabel(p.k)}: ${money(p.v, sym)}`}>
              <span className="dd-bar" style={{ height: `${(p.v / max) * 80}px` }} />
              <span className="dd-m">{monthLabel(p.k, { month: "short" }).slice(0, 3)}</span>
            </div>
          ))}
        </div>
        {Object.keys(byCat).length > 0 && (
          <div className="dd-cats">{Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([n, v]) => <span key={n} className="pill-s p-plain">{n} · {money(v, sym)}</span>)}</div>
        )}
        <div className="dd-list">
          {groups.map((g) => (
            <div key={g.k}>
              <div className="hist-dayname">{periodLabel(g.k)} · {money(g.items.reduce((s, e) => s + e.amount, 0), sym)}</div>
              {g.items.map((e) => (
                <div className="dd-row" key={e.id}>
                  <span className="num cl-date">{shortDate(e.date)}</span>
                  <span className="cl-main"><span className="cl-note">{e.note || "—"}</span><span className="cl-bank">{filter.type === "cat" ? bankLabel(e.bank) : (catById[e.cat]?.name || "Uncategorised")}{(e.tags || []).map((t) => <span key={t} className="tag-chip">#{t}</span>)}</span></span>
                  <span className={`num cl-amt ${e.amount < 0 ? "t-teal" : ""}`}>{moneySigned(e.amount, sym)}</span>
                </div>
              ))}
            </div>
          ))}
          {rows.length > 300 && <div className="empty">Showing the latest 300 of {rows.length}.</div>}
          {!rows.length && <div className="empty">Nothing recorded yet.</div>}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Unusual-spend alerts                                               */
/* ------------------------------------------------------------------ */
export function computeAlerts({ allExp, categories, catById, selMonth }) {
  const prev = [1, 2, 3].map((i) => shiftMonth(selMonth, -i));
  const isCur = selMonth === currentPeriod();
  const sum = {};
  allExp.forEach((e) => {
    if (!isSpend(e, catById)) return;
    const k = periodOf(e.date);
    if (k !== selMonth && !prev.includes(k)) return;
    const id = catById[e.cat] ? e.cat : "__uncat__";
    sum[id] = sum[id] || {};
    sum[id][k] = (sum[id][k] || 0) + e.amount;
  });
  const out = [];
  for (const c of categories) {
    if (c.section === NONSPEND_SECTION || isBillCat(c) || ["Annual", "Insurance", "LIC Policies"].includes(c.section)) continue;
    const s = sum[c.id] || {};
    const now = s[selMonth] || 0;
    const hist = prev.map((k) => s[k] || 0);
    if (hist.filter((v) => v > 0).length < 2) continue;
    const avg = hist.reduce((a, b) => a + b, 0) / 3;
    if (avg < 1000) continue;
    if (now > avg * 1.3 && now - avg >= 1500) {
      out.push({ id: c.id, name: c.name, now, avg, pct: Math.round((now / avg - 1) * 100), already: isCur });
    }
  }
  // one-off large payments outside the usual bills
  const big = allExp.filter((e) => periodOf(e.date) === selMonth && e.amount >= 10000 && isSpend(e, catById)
    && !isBillCat(catById[e.cat]) && !["Annual", "Insurance", "LIC Policies"].includes(catById[e.cat]?.section));
  const seen = new Set(allExp.filter((e) => periodOf(e.date) < selMonth).map((e) => merchantKey(e.note || "")));
  for (const e of big) {
    const k = merchantKey(e.note || "");
    if (k && !seen.has(k)) out.push({ id: "big:" + e.id, name: titleCase(k), now: e.amount, big: true, cat: catById[e.cat]?.name || "Uncategorised", date: e.date });
  }
  return out.sort((a, b) => (b.now - (b.avg || 0)) - (a.now - (a.avg || 0))).slice(0, 5);
}

export function AlertsStrip({ alerts, sym, onPick }) {
  const [hidden, setHidden] = useState(false);
  if (!alerts.length || hidden) return null;
  return (
    <section className="alerts" aria-label="Unusual spending">
      <div className="alerts-head">
        <span><TriangleAlert size={15} /> Unusual spending</span>
        <button className="link-btn" onClick={() => setHidden(true)}>Hide</button>
      </div>
      <ul>
        {alerts.map((a) => (
          <li key={a.id}>
            <button type="button" onClick={() => onPick(a)}>
              {a.big
                ? <><strong>{a.name}</strong> — one payment of <span className="num">{money(a.now, sym)}</span> on {shortDate(a.date)} ({a.cat}), a payee you haven't paid before.</>
                : <><strong>{a.name}</strong> is <span className="num">{money(a.now, sym)}</span>{a.already ? " so far" : ""} — <strong className="t-red">{a.pct}% above</strong> your 3-month average of <span className="num">{money(a.avg, sym)}</span>.</>}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Account balances & card dues                                       */
/* ------------------------------------------------------------------ */
export function latestBalances(balances) {
  return BANKS.map((b) => ({ bank: b, x: (balances[b.key] || [])[0] || null }));
}
export function BalancesCard({ balances, credits, sym, onSet }) {
  const [editing, setEditing] = useState(null);
  const [val, setVal] = useState("");
  const rows = latestBalances(balances);
  const savings = rows.filter((r) => r.bank.mode !== "card");
  const cards = rows.filter((r) => r.bank.mode === "card");
  const total = savings.reduce((s, r) => s + (r.x?.balance || 0), 0);
  const today = todayIso();
  const save = (bank) => { const v = parseFloat(val); if (!isNaN(v)) onSet(bank, { asOf: today, balance: v, src: "manual" }); setEditing(null); setVal(""); };

  return (
    <section className="panel card-balances">
      <div className="card-head">
        <h2>Balances &amp; card dues</h2>
        <span className="card-meta num">{money(total, sym)} in accounts</span>
      </div>
      <ul className="bal-list">
        {savings.map(({ bank, x }) => (
          <li key={bank.key}>
            <span className="bal-main"><span className="bal-name">{bank.label}</span><span className="bal-sub">{x ? `as of ${shortDate(x.asOf)}${x.src === "manual" ? " · entered by hand" : " · from statement"}` : "Import a statement to see its balance"}</span></span>
            {editing === bank.key ? (
              <span className="bal-edit">
                <input type="number" autoFocus value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save(bank.key)} aria-label={`${bank.label} balance`} />
                <button className="icon-btn" aria-label="Save" onClick={() => save(bank.key)}><Check size={14} /></button>
              </span>
            ) : (
              <button type="button" className="bal-amt num" onClick={() => { setEditing(bank.key); setVal(x?.balance ?? ""); }} title="Update balance">
                {x?.balance != null ? moneySigned(x.balance, sym) : "—"}
              </button>
            )}
          </li>
        ))}
      </ul>
      <div className="hist-dayname" style={{ marginTop: 12 }}>Credit cards</div>
      <ul className="bal-list">
        {cards.map(({ bank, x }) => {
          const paid = x?.dueDate && credits.some((c) => c.bank === bank.key && c.kind === "card_payment" && c.date >= (x.statementDate || x.asOf || "") && c.amount >= (x.minDue || 0));
          const overdue = x?.dueDate && !paid && x.dueDate < today;
          const days = x?.dueDate ? Math.round((Date.parse(x.dueDate) - Date.parse(today)) / 864e5) : null;
          return (
            <li key={bank.key}>
              <span className="bal-main"><span className="bal-name">{bank.label}</span>
                <span className={`bal-sub ${overdue ? "t-red" : days != null && days <= 7 && !paid ? "t-amber" : ""}`}>
                  {x?.dueDate ? (paid ? `Paid · was due ${shortDate(x.dueDate)}` : overdue ? `Overdue since ${shortDate(x.dueDate)}` : `Due ${shortDate(x.dueDate)} (${days} day${days === 1 ? "" : "s"})`) : "Import this card's statement to see dues"}
                  {x?.minDue ? ` · min ${money(x.minDue, sym)}` : ""}
                </span>
              </span>
              <span className={`bal-amt num ${overdue ? "t-red" : ""}`}>{x?.amountDue != null ? money(x.amountDue, sym) : "—"}</span>
            </li>
          );
        })}
      </ul>
      <p className="card-note">Balances come from the last row of each imported statement; tap an amount to correct it.</p>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Savings goals                                                      */
/* ------------------------------------------------------------------ */
export function GoalsCard({ goals, sym, onSave }) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: "", target: "", by: "" });
  const [topUp, setTopUp] = useState({});
  const cur = currentPeriod();
  const monthsTo = (by) => { if (!by) return null; const [y1, m1] = cur.split("-").map(Number), [y2, m2] = by.split("-").map(Number); return (y2 - y1) * 12 + (m2 - m1); };
  const savedOf = (g) => (g.log || []).reduce((s, x) => s + x.amount, 0);
  const add = () => {
    const t = parseFloat(form.target);
    if (!form.name.trim() || !(t > 0)) return;
    onSave([...goals, { id: uid(), name: form.name.trim(), target: t, by: form.by || "", log: [] }]);
    setForm({ name: "", target: "", by: "" }); setAdding(false);
  };
  const contribute = (g) => {
    const v = parseFloat(topUp[g.id]);
    if (!v) return;
    onSave(goals.map((x) => (x.id === g.id ? { ...x, log: [...(x.log || []), { date: todayIso(), amount: v }] } : x)));
    setTopUp({ ...topUp, [g.id]: "" });
  };
  const remove = (g) => { if (window.confirm(`Remove the goal "${g.name}"?`)) onSave(goals.filter((x) => x.id !== g.id)); };

  return (
    <section className="panel card-goals">
      <div className="card-head">
        <h2>Savings goals</h2>
        <button className="link-btn" onClick={() => setAdding((v) => !v)}><Plus size={14} /> New goal</button>
      </div>
      {adding && (
        <div className="goal-form">
          <input placeholder="Goal, e.g. Holiday fund" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} aria-label="Goal name" />
          <input type="number" placeholder="Target ₹" value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} aria-label="Target amount" />
          <label className="qa-label" style={{ display: "flex", alignItems: "center", gap: 6 }}>by <input type="month" value={form.by} onChange={(e) => setForm({ ...form, by: e.target.value })} aria-label="Target month" /></label>
          <button className="btn-add" onClick={add}>Add</button>
        </div>
      )}
      {!goals.length && !adding && <div className="empty">No goals yet — add one, like a holiday fund or an emergency fund, and log what you put aside.</div>}
      {goals.map((g) => {
        const saved = savedOf(g), pct = Math.min(100, (saved / g.target) * 100), left = Math.max(0, g.target - saved);
        const m = monthsTo(g.by);
        return (
          <div className="sa-row goal" key={g.id}>
            <div className="sa-top">
              <span className="sa-name">{g.name}</span>
              <span className="num sa-amt">{money(saved, sym)} / {money(g.target, sym)}</span>
            </div>
            <span className="sa-track"><span style={{ width: `${pct}%`, background: pct >= 100 ? "var(--teal)" : "#3D5A80" }} /></span>
            <span className="sa-sub">
              {pct >= 100 ? "Reached 🎉" : m != null && m > 0 ? <>{money(left, sym)} to go · <strong className="num">{money(left / m, sym)}</strong>/month to reach it by {monthLabel(g.by, { month: "short", year: "numeric" })}</> : m != null ? <span className="t-red">{money(left, sym)} short — target month has passed</span> : `${money(left, sym)} to go`}
            </span>
            <div className="goal-add">
              <input type="number" placeholder="Add ₹" value={topUp[g.id] || ""} onChange={(e) => setTopUp({ ...topUp, [g.id]: e.target.value })} onKeyDown={(e) => e.key === "Enter" && contribute(g)} aria-label={`Add to ${g.name}`} />
              <button className="btn-ghost sm" onClick={() => contribute(g)}>Put aside</button>
              <button className="icon-btn" aria-label={`Remove ${g.name}`} onClick={() => remove(g)}><Trash2 size={13} /></button>
            </div>
          </div>
        );
      })}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Tags                                                               */
/* ------------------------------------------------------------------ */
export const parseTags = (s) => [...new Set(String(s || "").split(/[,\s]+/).map((t) => t.replace(/^#/, "").trim().toLowerCase()).filter(Boolean))];

export function TagsView({ allExp, catById, sym, onOpen }) {
  const tags = useMemo(() => {
    const m = {};
    allExp.forEach((e) => (e.tags || []).forEach((t) => {
      const r = m[t] || (m[t] = { t, total: 0, n: 0, first: e.date, last: e.date, cats: {} });
      r.total += e.amount; r.n += 1;
      if (e.date < r.first) r.first = e.date; if (e.date > r.last) r.last = e.date;
      const cn = catById[e.cat]?.name || "Uncategorised"; r.cats[cn] = (r.cats[cn] || 0) + e.amount;
    }));
    return Object.values(m).sort((a, b) => b.last.localeCompare(a.last));
  }, [allExp, catById]);
  return (
    <section className="panel">
      <div className="card-head"><h2>Trips &amp; events</h2></div>
      <p className="card-note" style={{ marginTop: 0 }}>Tag entries with a trip or event (e.g. <span className="tag-chip">#bangkok2026</span>) when adding or editing them — or search the entries list and use "Tag all shown". Each tag totals up across categories and months.</p>
      {!tags.length && <div className="empty">No tags yet.</div>}
      <div className="tag-grid">
        {tags.map((r) => (
          <button type="button" className="tag-card" key={r.t} onClick={() => onOpen(r.t)}>
            <span className="tag-chip big">#{r.t}</span>
            <strong className="num">{money(r.total, sym)}</strong>
            <span className="bal-sub">{r.n} entr{r.n === 1 ? "y" : "ies"} · {shortDate(r.first)} – {shortDate(r.last)}</span>
            <span className="tag-cats">{Object.entries(r.cats).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([n, v]) => <span key={n}>{n} {money(v, sym)}</span>)}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Split one entry across categories                                  */
/* ------------------------------------------------------------------ */
export function SplitModal({ entry, categories, sym, onSave, onClose }) {
  const [parts, setParts] = useState([{ cat: entry.cat, amount: String(entry.amount) }, { cat: "", amount: "" }]);
  const sum = parts.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);
  const diff = Math.round((entry.amount - sum) * 100) / 100;
  const ok = Math.abs(diff) < 0.01 && parts.filter((p) => parseFloat(p.amount) > 0).every((p) => p.cat) && parts.filter((p) => parseFloat(p.amount) > 0).length >= 2;
  const set = (i, k, v) => setParts(parts.map((p, j) => (j === i ? { ...p, [k]: v } : p)));
  return (
    <div className="qa-scrim" onClick={onClose}>
      <div className="qa-sheet" role="dialog" aria-modal="true" aria-label="Split entry" onClick={(e) => e.stopPropagation()}>
        <div className="qa-head"><h2>Split {money(entry.amount, sym)}</h2><button className="icon-btn" aria-label="Close" onClick={onClose}><X size={18} /></button></div>
        <p className="card-note" style={{ margin: 0 }}>{entry.date} · {entry.note || "—"}</p>
        {parts.map((p, i) => (
          <div className="split-row" key={i}>
            <select value={p.cat} onChange={(e) => set(i, "cat", e.target.value)} aria-label={`Category ${i + 1}`}>
              <option value="">— category —</option>
              {SECTIONS.map((sec) => { const o = categories.filter((c) => c.section === sec); return o.length ? <optgroup key={sec} label={sec}>{o.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup> : null; })}
            </select>
            <input type="number" min="0" value={p.amount} onChange={(e) => set(i, "amount", e.target.value)} aria-label={`Amount ${i + 1}`} />
            {parts.length > 2 && <button className="icon-btn" aria-label="Remove part" onClick={() => setParts(parts.filter((_, j) => j !== i))}><X size={14} /></button>}
          </div>
        ))}
        <button className="link-btn" onClick={() => setParts([...parts, { cat: "", amount: diff > 0 ? String(diff) : "" }])}><Plus size={14} /> Add another part</button>
        <div className={`split-left ${Math.abs(diff) < 0.01 ? "t-teal" : "t-amber"}`}>{Math.abs(diff) < 0.01 ? "Adds up ✓" : diff > 0 ? `${money(diff, sym)} still to assign` : `${money(-diff, sym)} too much`}</div>
        <div className="qa-actions">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-add" disabled={!ok} onClick={() => onSave(parts.filter((p) => parseFloat(p.amount) > 0).map((p) => ({ cat: p.cat, amount: parseFloat(p.amount) })))}><Check size={16} /> Split into {parts.filter((p) => parseFloat(p.amount) > 0).length}</button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Calendar & weekly views                                            */
/* ------------------------------------------------------------------ */
export function CalendarView({ allExp, credits, categories, expenses, cardDue, balances, catById, selMonth, sym }) {
  const [mode, setMode] = useState("month");
  const [day, setDay] = useState(null);
  const dates = periodDates(selMonth);
  const spend = {}, items = {};
  allExp.forEach((e) => {
    if (periodOf(e.date) !== selMonth || !isSpend(e, catById)) return;
    spend[e.date] = (spend[e.date] || 0) + e.amount;
    (items[e.date] = items[e.date] || []).push(e);
  });
  const inc = {};
  credits.forEach((c) => { if (periodOf(c.date) === selMonth && isIncome(c.kind)) inc[c.date] = (inc[c.date] || 0) + c.amount; });
  const bills = billsForMonth({ categories, expenses, credits, cardDue, balances, selMonth }).filter((b) => b.date);
  const billsOn = {}; bills.forEach((b) => (billsOn[b.date] = billsOn[b.date] || []).push(b));
  const vals = Object.values(spend); const max = Math.max(...vals, 1);
  const today = todayIso();
  const lead = (new Date(dates[0] + "T00:00:00").getDay() + 6) % 7; // Monday first

  // weeks (Mon–Sun) inside this ledger month
  const weeks = [];
  dates.forEach((d) => {
    const dow = (new Date(d + "T00:00:00").getDay() + 6) % 7;
    if (!weeks.length || dow === 0) weeks.push({ from: d, to: d, total: 0, days: 0 });
    const w = weeks[weeks.length - 1]; w.to = d; w.total += spend[d] || 0; w.days += 1;
  });
  const wmax = Math.max(...weeks.map((w) => w.total), 1);
  let wkEnd = 0, wkEndN = 0, wkDay = 0, wkDayN = 0;
  dates.filter((d) => d <= today).forEach((d) => { const dow = new Date(d + "T00:00:00").getDay(); if (dow === 0 || dow === 6) { wkEnd += spend[d] || 0; wkEndN++; } else { wkDay += spend[d] || 0; wkDayN++; } });
  const sel = day && (items[day] || billsOn[day] || inc[day]) ? day : null;

  return (
    <section className="panel">
      <div className="card-head">
        <h2>{mode === "month" ? "Calendar" : "Weekly"} · {periodLabel(selMonth)}</h2>
        <div className="seg-toggle" role="tablist">
          <button role="tab" aria-selected={mode === "month"} className={mode === "month" ? "on" : ""} onClick={() => setMode("month")}>Month</button>
          <button role="tab" aria-selected={mode === "week"} className={mode === "week" ? "on" : ""} onClick={() => setMode("week")}>Weeks</button>
        </div>
      </div>
      {mode === "month" ? <>
        <div className="cal-grid" role="grid">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="cal-dow">{d}</div>)}
          {Array.from({ length: lead }, (_, i) => <div key={"x" + i} />)}
          {dates.map((d) => {
            const v = spend[d] || 0;
            const shade = v ? 0.12 + 0.6 * Math.sqrt(v / max) : 0;
            const b = billsOn[d] || [];
            const late = b.some((x) => x.status === "overdue"), soon = b.some((x) => x.status === "soon");
            return (
              <button type="button" role="gridcell" key={d} className={`cal-cell${d === today ? " today" : ""}${sel === d ? " sel" : ""}`}
                style={{ background: v ? `rgba(14,124,107,${shade})` : undefined, color: shade > 0.45 ? "#fff" : undefined }}
                onClick={() => setDay(d)} aria-label={`${shortDate(d)}: spent ${money(v, sym)}${inc[d] ? `, income ${money(inc[d], sym)}` : ""}${b.length ? `, ${b.length} bill due` : ""}`}>
                <span className="cal-d">{Number(d.slice(8, 10))}</span>
                {v > 0 && <span className="cal-v num">{v >= 100000 ? `${(v / 100000).toFixed(1)}L` : v >= 1000 ? `${Math.round(v / 1000)}k` : Math.round(v)}</span>}
                <span className="cal-dots">
                  {inc[d] && <i className="dot in" title="Income" />}
                  {b.length > 0 && <i className={`dot ${late ? "over" : soon ? "soon" : b.every((x) => x.status === "paid") ? "paid" : "due"}`} title="Bill due" />}
                </span>
              </button>
            );
          })}
        </div>
        <div className="tl-legend">
          <span><i style={{ background: "rgba(14,124,107,.55)", borderRadius: 3 }} />Darker = more spent</span>
          <span><i style={{ background: "var(--teal)" }} />Income</span>
          <span><i style={{ background: "var(--red)" }} />Bill overdue</span>
          <span><i style={{ background: "var(--amber)" }} />Bill due in 7 days</span>
          <span><i style={{ background: "var(--ink)" }} />Bill due</span>
        </div>
        {sel && (
          <div className="cal-day">
            <div className="hist-dayname">{new Date(sel + "T00:00:00").toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })} · spent {money(spend[sel] || 0, sym)}{inc[sel] ? ` · income +${money(inc[sel], sym)}` : ""}</div>
            {(billsOn[sel] || []).map((b) => <div className="dd-row" key={b.id}><span className="pill-s p-warn">bill</span><span className="cl-main"><span className="cl-note">{b.name}</span><span className="cl-bank">{b.status}</span></span><span className="num cl-amt">{money(b.due, sym)}</span></div>)}
            {(items[sel] || []).map((e) => <div className="dd-row" key={e.id}><span className="cl-date">{catById[e.cat]?.name || "Uncategorised"}</span><span className="cl-main"><span className="cl-note">{e.note || "—"}</span><span className="cl-bank">{bankLabel(e.bank)}</span></span><span className="num cl-amt">{moneySigned(e.amount, sym)}</span></div>)}
          </div>
        )}
      </> : <>
        <div className="wk-list">
          {weeks.map((w) => (
            <div className="wk-row" key={w.from}>
              <span className="wk-lbl">{shortDate(w.from)} – {shortDate(w.to)}</span>
              <span className="wk-track"><span style={{ width: `${(w.total / wmax) * 100}%` }} /></span>
              <span className="num wk-amt">{money(w.total, sym)}</span>
              <span className="num wk-avg">{money(w.total / w.days, sym)}/day</span>
            </div>
          ))}
        </div>
        <p className="card-note">So far this month: weekdays average <strong className="num">{money(wkDayN ? wkDay / wkDayN : 0, sym)}</strong>/day, weekends <strong className="num">{money(wkEndN ? wkEnd / wkEndN : 0, sym)}</strong>/day. Includes bills, so weeks with the EMI or premiums stand out.</p>
      </>}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Ask your ledger                                                    */
/* ------------------------------------------------------------------ */
const EXAMPLES = [
  "How much did we spend on Food & Travel in the last 3 months, month by month?",
  "Which categories went over budget this financial year, and by how much?",
  "What did the Bangkok trip cost in total?",
  "How much did Manali spend on shopping since April?",
  "Which bills are still due this month?",
];
export function AskView() {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState([]);
  const [err, setErr] = useState("");
  const end = useRef(null);
  useEffect(() => { end.current && end.current.scrollIntoView({ behavior: "smooth", block: "end" }); }, [log.length]);
  const ask = async (question) => {
    const text = (question || q).trim();
    if (!text || busy) return;
    setBusy(true); setErr("");
    try {
      await store.flush();
      const j = await api("/api/ask", { method: "POST", body: JSON.stringify({ question: text, monthStart: getMonthStart(), today: todayIso(), history: log.slice(-3) }) });
      setLog((l) => [...l, { q: text, a: j.answer }]); setQ("");
    } catch (e) { setErr(e.message || "Couldn't get an answer."); }
    setBusy(false);
  };
  return (
    <section className="panel ask">
      <div className="card-head"><h2><Sparkles size={15} style={{ verticalAlign: "-2px" }} /> Ask your ledger</h2></div>
      <p className="card-note" style={{ marginTop: 0 }}>Ask in plain English. Claude reads your last 12 months of entries, money in, budgets, goals and balances to answer — the same Anthropic connection the categoriser already uses. Check important figures against the entries.</p>
      {!log.length && <div className="ask-ex">{EXAMPLES.map((x) => <button type="button" key={x} className="chip" onClick={() => ask(x)} disabled={busy}>{x}</button>)}</div>}
      <div className="ask-log">
        {log.map((m, i) => (
          <div key={i} className="ask-pair">
            <div className="ask-q">{m.q}</div>
            <div className="ask-a">{m.a}</div>
          </div>
        ))}
        {busy && <div className="ask-a muted">Thinking…</div>}
        <div ref={end} />
      </div>
      {err && <div className="imp-err" role="alert">{err}</div>}
      <form className="ask-form" onSubmit={(e) => { e.preventDefault(); ask(); }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. How much went on groceries in September?" aria-label="Your question" />
        <button className="btn-add" type="submit" disabled={busy || !q.trim()}><Send size={15} /> Ask</button>
      </form>
    </section>
  );
}

export const featuresCss = `
.dd-sheet{max-width:720px;}
.dd-bars{display:flex; align-items:flex-end; gap:6px; height:104px; border-bottom:1px solid var(--hairline);}
.dd-col{flex:1; display:flex; flex-direction:column; align-items:center; gap:4px;}
.dd-bar{width:100%; max-width:26px; background:var(--teal); border-radius:4px 4px 0 0; display:block; min-height:1px;}
.dd-m{font-size:10.5px; color:var(--muted);}
.dd-cats{display:flex; flex-wrap:wrap; gap:6px;}
.dd-list{display:flex; flex-direction:column; gap:10px;}
.dd-row{display:grid; grid-template-columns:70px minmax(0,1fr) auto; gap:10px; align-items:center; padding:7px 0; border-bottom:1px solid var(--hairline); font-size:13px;}
.tag-chip{display:inline-block; background:#EEF0FA; color:#3D5A80; font-size:10.5px; font-weight:600; padding:1px 6px; border-radius:5px; margin-left:5px; font-family:'JetBrains Mono',monospace;}
.tag-chip.big{font-size:13px; padding:3px 8px; margin:0;}
.alerts{background:#FFF8EE; border:1px solid #F3D9B5; border-radius:16px; padding:12px 16px; margin-bottom:16px;}
.alerts-head{display:flex; justify-content:space-between; align-items:center; font-size:13px; font-weight:600; color:var(--amber);}
.alerts-head span{display:inline-flex; align-items:center; gap:6px;}
.alerts ul{list-style:none; margin:6px 0 0; padding:0;}
.alerts li button{border:0; background:none; text-align:left; font:inherit; font-size:13.5px; color:var(--ink); padding:6px 0; cursor:pointer; width:100%;}
.alerts li button:hover{text-decoration:underline;}
.card-balances,.card-goals{flex:1 1 340px;}
.bal-list{list-style:none; margin:0; padding:0;}
.bal-list li{display:flex; align-items:center; gap:12px; padding:8px 0; border-bottom:1px solid var(--hairline);}
.bal-main{flex:1; min-width:0; display:flex; flex-direction:column;}
.bal-name{font-size:13.5px; font-weight:500;}
.bal-sub{font-size:11.5px; color:var(--muted);}
.bal-amt{font-size:14px; font-weight:600; border:0; background:none; color:var(--ink); cursor:pointer; padding:4px 0;}
.bal-edit{display:flex; gap:4px;}
.bal-edit input{width:120px; height:34px; border:1px solid var(--hairline); border-radius:8px; padding:0 8px; font:500 13px 'JetBrains Mono',monospace;}
.goal-form{display:flex; flex-wrap:wrap; gap:8px; margin-bottom:10px;}
.goal-form input{height:38px; border:1px solid var(--hairline); border-radius:10px; padding:0 10px; font:500 13px Inter,sans-serif; background:var(--surface); color:var(--ink);}
.goal-form input:first-child{flex:1 1 160px;}
.goal-add{display:flex; gap:6px; align-items:center; margin-top:4px;}
.goal-add input{width:110px; height:32px; border:1px solid var(--hairline); border-radius:8px; padding:0 8px; font:500 12.5px 'JetBrains Mono',monospace;}
.goal{padding-bottom:10px; border-bottom:1px solid var(--hairline);}
.tag-grid{display:grid; grid-template-columns:repeat(auto-fill,minmax(230px,1fr)); gap:12px;}
.tag-card{display:flex; flex-direction:column; gap:6px; text-align:left; border:1px solid var(--hairline); border-radius:14px; background:var(--surface); padding:14px; cursor:pointer; font:inherit; color:inherit;}
.tag-card:hover{border-color:var(--ink);}
.tag-card strong{font-size:20px;}
.tag-cats{display:flex; flex-wrap:wrap; gap:4px 10px; font-size:11.5px; color:var(--muted);}
.split-row{display:grid; grid-template-columns:minmax(0,1fr) 120px auto; gap:8px;}
.split-row select,.split-row input{height:40px; border:1px solid var(--hairline); border-radius:10px; padding:0 10px; font:500 13.5px Inter,sans-serif; background:var(--surface); color:var(--ink);}
.split-left{font-size:13px; font-weight:600;}
.cal-grid{display:grid; grid-template-columns:repeat(7,minmax(0,1fr)); gap:6px;}
.cal-dow{font-size:11px; font-weight:600; color:var(--muted); text-align:center; text-transform:uppercase; letter-spacing:.05em;}
.cal-cell{position:relative; min-height:70px; border:1px solid var(--hairline); border-radius:10px; background:var(--surface); display:flex; flex-direction:column; align-items:flex-start; padding:6px 7px; gap:2px; cursor:pointer; font:inherit; color:var(--ink); text-align:left;}
.cal-cell.today{outline:2px solid var(--ink); outline-offset:-2px;}
.cal-cell.sel{box-shadow:0 0 0 3px rgba(23,27,30,.25);}
.cal-d{font-size:12px; font-weight:600;}
.cal-v{font-size:12px; font-weight:600;}
.cal-dots{position:absolute; right:6px; top:6px; display:flex; gap:3px;}
.dot{width:8px; height:8px; border-radius:50%; display:block; border:1.5px solid #fff;}
.dot.in{background:var(--teal);} .dot.over{background:var(--red);} .dot.soon{background:var(--amber);} .dot.due{background:var(--ink);} .dot.paid{background:#B9C1C6;}
.cal-day{margin-top:14px;}
.wk-list{display:flex; flex-direction:column; gap:10px;}
.wk-row{display:grid; grid-template-columns:130px minmax(0,1fr) 110px 90px; gap:12px; align-items:center; font-size:13px;}
.wk-lbl{color:var(--muted);}
.wk-track{height:12px; background:#EEF1F2; border-radius:6px; overflow:hidden; display:block;}
.wk-track span{display:block; height:12px; background:var(--teal); border-radius:6px;}
.wk-amt{font-weight:600; text-align:right;} .wk-avg{color:var(--muted); text-align:right; font-size:12px;}
.ask-ex{display:flex; flex-wrap:wrap; gap:8px; margin:6px 0 12px;}
.ask-ex .chip{text-align:left; height:auto; padding:8px 12px; line-height:1.35;}
.ask-log{display:flex; flex-direction:column; gap:14px; margin:8px 0 12px;}
.ask-q{align-self:flex-end; background:var(--ink); color:#fff; border-radius:14px 14px 4px 14px; padding:9px 13px; font-size:13.5px; max-width:80%;}
.ask-a{background:var(--bg); border-radius:14px 14px 14px 4px; padding:11px 14px; font-size:13.5px; line-height:1.55; white-space:pre-wrap; max-width:92%;}
.ask-a.muted{color:var(--muted);}
.ask-pair{display:flex; flex-direction:column; gap:8px;}
.ask-form{display:flex; gap:8px;}
.ask-form input{flex:1; height:46px; border:1px solid var(--hairline); border-radius:12px; padding:0 14px; font:500 14px Inter,sans-serif; background:var(--surface); color:var(--ink);}
.entries .en-refund .en-amt{color:var(--teal);}
.en-split{font-size:10px; font-weight:700; color:var(--muted); margin-left:5px; text-transform:uppercase;}
.tagall{display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin:-4px 0 12px; font-size:12.5px; color:var(--muted);}
.tagall input{height:34px; border:1px solid var(--hairline); border-radius:9px; padding:0 10px; font:500 13px Inter,sans-serif; width:180px;}
.ms-row{display:flex; align-items:center; gap:8px; font-size:13px; padding:10px 0;}
.ms-row input{width:64px; height:34px; border:1px solid var(--hairline); border-radius:8px; padding:0 8px; font:500 13px 'JetBrains Mono',monospace;}
@media (max-width:820px){
  .cal-grid{gap:3px;} .cal-cell{min-height:52px; padding:4px;} .cal-v{font-size:10.5px;}
  .wk-row{grid-template-columns:96px minmax(0,1fr) 84px;} .wk-avg{display:none;}
  .dd-row{grid-template-columns:56px minmax(0,1fr) auto;}
}
`;
