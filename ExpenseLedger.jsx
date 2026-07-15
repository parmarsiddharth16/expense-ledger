import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  ChevronLeft, ChevronRight, Plus, Trash2, SlidersHorizontal, X,
  TriangleAlert, Check, Wallet, ArrowUpRight, Sparkles, Eye, EyeOff,
  Upload, FileSpreadsheet, ArrowRight, Search, Info, BarChart2, Pencil, Download
} from "lucide-react";
import {
  ComposedChart, BarChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, Legend
} from "recharts";
import Papa from "papaparse";
import * as XLSX from "xlsx";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */
const CURRENCIES = ["₹", "$", "€", "£", "¥", "AED ", "S$"];
const uid = () =>
  (typeof crypto !== "undefined" && crypto.randomUUID)
    ? crypto.randomUUID()
    : String(Date.now()) + Math.random().toString(16).slice(2);
const inr = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const money = (n, s) => `${s}${inr.format(Math.round(Math.abs(n || 0)))}`;
const moneySigned = (n, s) => `${n < 0 ? "−" : ""}${money(n, s)}`;
const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const shiftMonth = (k, delta) => {
  const [y, m] = k.split("-").map(Number);
  return monthKey(new Date(y, m - 1 + delta, 1));
};
const monthLabel = (k, o = { month: "long", year: "numeric" }) => {
  const [y, m] = k.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", o);
};
const todayISO = () => new Date().toISOString().slice(0, 10);

const FY_START = "2026-04", FY_END = "2027-03";

/* map planner order [Apr..Mar] -> calendar index [Jan..Dec] */
const P2C = [9, 10, 11, 0, 1, 2, 3, 4, 5, 6, 7, 8];
const cal = (p) => P2C.map((i) => p[i]);
const flat = (n) => Array(12).fill(n);
const at = (i, v) => { const a = Array(12).fill(0); a[i] = v; return a; };
const isFlat = (a) => a.every((x) => x === a[0]);

const SECTIONS = [
  "Household Fixed", "Utilities", "Personal", "Lifestyle",
  "Shopping", "Annual", "Insurance", "LIC Policies",
];
/* Categories that require a person tag when logging */
const PERSON_CATS = new Set([
  "Medical", "Mobile", "Holiday", "Food & Travel",
  "Entertainment", "Shopping", "Parlour",
]);
/* Old category names → new names (for data migration on reseed) */
const LEGACY_NAMES = {
  // v2→v3
  "Manali Recharge Mobile": "Mobile",
  "Gotu & SRP Mobile": "Mobile",
  "Self Food & Travel (Sid)": "Food & Travel",
  "Spouse F&T (SRP)": "Food & Travel",
  "Family F&T": "Food & Travel",
  "Sid Gifts": "Gifts",
  "MN Shopping": "Shopping",
  "SRP Shopping": "Shopping",
  "Shopping Sid": "Shopping",
  "Parlour Mom & Sid": "Parlour",
  // v4→v5
  "Society Maint. Manhar": "Maintenance Manhar",
  "Society Maint. Panchamrut": "Maintenance Panchamrut",
  "Cook / Caretaker": "Caretaker",
  "Utilities (Bai)": "Cook",
  "Manali's Allowance": "Allowance",
  "House-Hold / Interior": "Household",
  "Subscription OTT + TOI": "Subscription OTT",
};

/* [name, section, recurring, planner order Apr..Mar] */
const SEED = [
  // Household Fixed — fixed costs of running the home
  ["EMI", "Household Fixed", true, flat(120850)],
  ["Grocery", "Household Fixed", true, flat(18000)],
  ["Maintenance Panchamrut", "Household Fixed", true, [2600,2600,2600,2600,2600,2600,2600,1800,1800,1800,1800,1800]],
  ["Electricity Manhar", "Household Fixed", true, flat(2500)],
  ["WiFi / Cable", "Household Fixed", true, flat(1250)],
  ["Gas Manhar", "Household Fixed", true, flat(625)],
  ["Maintenance Manhar", "Household Fixed", true, flat(7500)],
  // Utilities — household help & consumables
  ["Cook", "Utilities", true, flat(5000)],
  ["Caretaker", "Utilities", true, flat(16500)],
  ["Laundry", "Utilities", true, flat(1000)],
  ["Flower", "Utilities", true, flat(250)],
  ["Bai", "Utilities", true, flat(5500)],
  // Personal
  ["Allowance", "Personal", true, flat(15000)],
  ["Medical", "Personal", true, flat(5000)],
  ["Mobile", "Personal", true, flat(1000)],
  ["Parlour", "Personal", true, flat(5000)],
  ["Bike", "Personal", true, flat(2000)],
  // Lifestyle
  ["Food & Travel", "Lifestyle", true, flat(20000)],
  ["Entertainment", "Lifestyle", true, flat(2100)],
  ["Subscription OTT", "Lifestyle", true, flat(1000)],
  ["Household", "Lifestyle", true, flat(10000)],
  ["Holiday", "Lifestyle", true, flat(40000)],
  ["Gifts", "Lifestyle", true, flat(2500)],
  ["Yoga / Gym", "Lifestyle", true, flat(5000)],
  // Shopping — merged MN + SRP + Sid budgets
  ["Shopping", "Shopping", true, [20100,7200,22500,7200,15000,7500,14000,10500,14200,7200,8200,16400]],
  // Annual
  ["Property Tax - Manhar", "Annual", false, at(6, 18824)],
  ["Locker Rent (SBI)", "Annual", false, at(5, 4000)],
  // Insurance
  ["Health Ins. Mom", "Insurance", false, at(9, 91680)],
  ["Health Ins. Sid", "Insurance", false, at(1, 9876)],
  ["Health Ins. Manali", "Insurance", false, at(1, 11439)],
  // LIC Policies
  ["991927505 - LIC", "LIC Policies", false, at(8, 2705)],
  ["991927507 - LIC", "LIC Policies", false, at(8, 3224)],
  ["991927510 - LIC", "LIC Policies", false, at(8, 3696)],
  ["906281172 - LIC", "LIC Policies", false, at(10, 2061)],
  ["992131496 - LIC", "LIC Policies", false, at(10, 38719)],
  ["912832805 - LIC", "LIC Policies", false, at(11, 106506)],
  ["935433613 - LIC", "LIC Policies", false, at(1, 11832)],
];
const buildCats = () =>
  SEED.map(([name, section, recurring, p]) => ({ id: uid(), name, section, recurring, monthly: cal(p) }));
const buildIncome = () => [
  { id: uid(), name: "Salary", monthly: flat(400000) },
  { id: uid(), name: "Rent Income", monthly: flat(29000) },
];

/* -------------------------------------------------------------------------
 * Cloud-backed store.
 * Data now lives in a single JSON blob on the server (/api/data, Vercel Blob)
 * so it persists across devices, browsers, and deployments. localStorage is
 * kept as an offline cache / fallback: if the network or the blob store is
 * unavailable, the app still works exactly as it did before (device-local).
 * Bank-statement passwords (ledger:*Pwd) are deliberately NOT synced — they
 * stay on the device only.
 * ---------------------------------------------------------------------- */
const SENSITIVE = /Pwd$/; // password keys never leave the device
const store = {
  cache: null,
  ready: false,
  _timer: null,
  async init() {
    if (this.ready) return;
    this.cache = {};
    // seed from localStorage first (works offline / instant)
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith("ledger:") || SENSITIVE.test(key)) continue;
        try { this.cache[key] = JSON.parse(localStorage.getItem(key)); }
        catch { this.cache[key] = localStorage.getItem(key); }
      }
    } catch {}
    // overlay the cloud copy (source of truth across devices)
    try {
      const res = await fetch("/api/data", { cache: "no-store" });
      if (res.ok) {
        const json = await res.json();
        const remote = json && json.data;
        if (remote && typeof remote === "object" && Object.keys(remote).length) {
          this.cache = { ...this.cache, ...remote };
          try { for (const k in remote) localStorage.setItem(k, JSON.stringify(remote[k])); } catch {}
        }
      }
    } catch {}
    this.ready = true;
  },
  async get(k) {
    if (this.cache && k in this.cache) return this.cache[k];
    try { const r = localStorage.getItem(k); return r ? JSON.parse(r) : null; } catch { return null; }
  },
  async set(k, v) {
    if (!this.cache) this.cache = {};
    this.cache[k] = v;
    try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { console.error(e); }
    if (!SENSITIVE.test(k)) this._scheduleSync();
  },
  _scheduleSync() {
    if (this._timer) clearTimeout(this._timer);
    this._timer = setTimeout(() => this._sync(), 800);
  },
  async _sync() {
    const payload = {};
    for (const k in this.cache) if (!SENSITIVE.test(k)) payload[k] = this.cache[k];
    try {
      await fetch("/api/data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: payload }),
      });
    } catch { /* stays in localStorage; retries on next change */ }
  },
};
const K_CATS = "ledger:categories", K_EXP = "ledger:expenses", K_SET = "ledger:settings", K_INC = "ledger:income";
const K_MAP = "ledger:merchantMap", K_STMTS = "ledger:stmts";
const CAT_VERSION = 6;

const BANKS = [
  { key: "hdfc_regalia",  label: "HDFC Regalia CC",       auto: false },
  { key: "hdfc_solitaire",label: "HDFC Solitaire CC",      auto: false },
  { key: "bom",           label: "Bank of Maharashtra",    auto: true  },
  { key: "ubi",           label: "Union Bank of India",    auto: true  },
  { key: "hdfc_bank",     label: "HDFC Bank (Savings)",    auto: true  },
  { key: "sbi_srp",       label: "SBI SRP",                auto: false },
  { key: "sbi_sid",       label: "SBI Sid",                auto: false },
  { key: "sbi_mn",        label: "SBI MN",                 auto: false },
];

const mIdx = (k) => Number(k.slice(5, 7)) - 1;
const inFY = (k) => k >= FY_START && k <= FY_END;
const budgetFor = (c, k) => { const v = c.monthly[mIdx(k)] || 0; return c.recurring ? v : (inFY(k) ? v : 0); };

const BUDGET_POS = 70;
const widthForRatio = (p) => {
  if (p <= 0) return 0;
  if (p <= 1) return p * BUDGET_POS;
  return Math.min(BUDGET_POS + (Math.min(p - 1, 0.6) / 0.6) * (100 - BUDGET_POS), 100);
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */
export default function ExpenseLedger() {
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState([]);
  const [income, setIncome] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [sym, setSym] = useState("₹");
  const [selMonth, setSelMonth] = useState(monthKey(new Date()));
  const [manageOpen, setManageOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [merchantMap, setMerchantMap] = useState({});
  const [hideEmpty, setHideEmpty] = useState(true);
  const [stmts, setStmts] = useState({});

  const [fCat, setFCat] = useState("");
  const [fAmt, setFAmt] = useState("");
  const [fDate, setFDate] = useState(todayISO());
  const [fNote, setFNote] = useState("");
  const [fPerson, setFPerson] = useState([]);
  const [fBank, setFBank] = useState(() => { try { return localStorage.getItem("ledger:lastBank") || ""; } catch { return ""; } });
  const [catPersonMap, setCatPersonMap] = useState(() => { try { return JSON.parse(localStorage.getItem("ledger:catPersonMap") || "{}"); } catch { return {}; } });
  const [addedFlash, setAddedFlash] = useState(false);
  const [reportFlash, setReportFlash] = useState(false);
  const [backupFlash, setBackupFlash] = useState(false);
  const [view, setView] = useState("dashboard");
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [entrySearch, setEntrySearch] = useState("");

  /* ---- load once (with name-based expense remap on reseed) ---- */
  useEffect(() => {
    (async () => {
      await store.init();
      const ver = await store.get("ledger:catVersion");
      let cats = await store.get(K_CATS);
      let inc = await store.get(K_INC);
      let exps = (await store.get(K_EXP)) || [];
      const settings = (await store.get(K_SET)) || {};
      const mmap = (await store.get(K_MAP)) || {};
      const stmtsData = (await store.get(K_STMTS)) || {};

      if (ver !== CAT_VERSION || !cats || !cats.length) {
        const oldName = {};
        (cats || []).forEach((c) => (oldName[c.id] = c.name));
        const fresh = buildCats();
        const byName = {};
        fresh.forEach((c) => (byName[c.name] = c.id));
        if (exps.length) {
          exps = exps.map((e) => {
            const nm = oldName[e.cat];
            if (!nm) return e;
            const newId = byName[nm] || byName[LEGACY_NAMES[nm]];
            return newId ? { ...e, cat: newId } : e;
          });
          await store.set(K_EXP, exps);
        }
        cats = fresh;
        inc = buildIncome();
        await store.set(K_CATS, cats);
        await store.set(K_INC, inc);
        await store.set("ledger:catVersion", CAT_VERSION);
      }
      if (!inc) { inc = buildIncome(); await store.set(K_INC, inc); }

      setCategories(cats);
      setIncome(inc);
      setExpenses(exps);
      setMerchantMap(mmap);
      setStmts(stmtsData);
      setSym(settings.sym || "₹");
      setLoading(false);
    })();
  }, []);

  const saveCats = useCallback((n) => { setCategories(n); store.set(K_CATS, n); }, []);
  const saveInc = useCallback((n) => { setIncome(n); store.set(K_INC, n); }, []);
  const saveExps = useCallback((n) => { setExpenses(n); store.set(K_EXP, n); }, []);
  const saveSym = useCallback((s) => { setSym(s); store.set(K_SET, { sym: s }); }, []);
  const saveStmts = useCallback((n) => { setStmts(n); store.set(K_STMTS, n); }, []);

  useEffect(() => { if (!fCat && categories.length) setFCat(categories[0].id); }, [categories, fCat]);

  /* ---- derived ---- */
  const catById = useMemo(() => { const m = {}; categories.forEach((c) => (m[c.id] = c)); return m; }, [categories]);
  const monthExpenses = useMemo(() => expenses.filter((e) => e.date.slice(0, 7) === selMonth), [expenses, selMonth]);
  const spentByCat = useMemo(() => { const m = {}; monthExpenses.forEach((e) => (m[e.cat] = (m[e.cat] || 0) + e.amount)); return m; }, [monthExpenses]);

  const rows = useMemo(() => categories.map((c) => {
    const spent = spentByCat[c.id] || 0;
    const budget = budgetFor(c, selMonth);
    const ratio = budget > 0 ? spent / budget : spent > 0 ? Infinity : 0;
    let status = "ok";
    if (budget <= 0 && spent > 0) status = "unbudgeted";
    else if (ratio > 1) status = "over";
    else if (ratio >= 0.8) status = "caution";
    return { ...c, spent, budget, ratio, status };
  }), [categories, spentByCat, selMonth]);

  const orphanSpent = useMemo(
    () => monthExpenses.filter((e) => !catById[e.cat]).reduce((s, e) => s + e.amount, 0),
    [monthExpenses, catById]
  );

  const grouped = useMemo(() => {
    const out = [];
    SECTIONS.forEach((sec) => {
      const all = rows.filter((r) => r.section === sec);
      if (!all.length) return;
      const vis = hideEmpty ? all.filter((r) => !(r.budget === 0 && r.spent === 0)) : all;
      if (!vis.length) return;
      out.push({
        section: sec,
        rows: vis.sort((a, b) => b.spent - a.spent || b.budget - a.budget),
        budget: all.reduce((s, r) => s + r.budget, 0),
        spent: all.reduce((s, r) => s + r.spent, 0),
      });
    });
    if (orphanSpent > 0) {
      out.push({
        section: "Uncategorised",
        rows: [{ id: "__uncat__", name: "Uncategorised spend", section: "Uncategorised", budget: 0, spent: orphanSpent, ratio: Infinity, status: "unbudgeted" }],
        budget: 0, spent: orphanSpent,
      });
    }
    return out;
  }, [rows, hideEmpty, orphanSpent]);

  const totalBudget = useMemo(() => categories.reduce((s, c) => s + budgetFor(c, selMonth), 0), [categories, selMonth]);
  const totalSpent = useMemo(() => monthExpenses.reduce((s, e) => s + e.amount, 0), [monthExpenses]);
  const totalIncome = useMemo(() => income.reduce((s, l) => s + (l.monthly[mIdx(selMonth)] || 0), 0), [income, selMonth]);
  const remaining = totalBudget - totalSpent;
  const usedPct = totalBudget > 0 ? (totalSpent / totalBudget) * 100 : 0;
  const net = totalIncome - totalSpent;
  const savingsRate = totalIncome > 0 ? (net / totalIncome) * 100 : 0;
  const plannedNet = totalIncome - totalBudget;

  const overRows = rows.filter((r) => r.status === "over" || r.status === "unbudgeted");
  const hiddenCount = hideEmpty
    ? rows.filter((r) => r.budget === 0 && r.spent === 0).length
    : 0;
  const totalOver = overRows.reduce((s, r) => s + (r.budget > 0 ? r.spent - r.budget : r.spent), 0)
    + (orphanSpent > 0 ? orphanSpent : 0);

  const trend = useMemo(() => {
    const keys = [];
    for (let i = 5; i >= 0; i--) keys.push(shiftMonth(selMonth, -i));
    return keys.map((k) => ({
      label: monthLabel(k, { month: "short" }),
      spent: expenses.filter((e) => e.date.slice(0, 7) === k).reduce((s, e) => s + e.amount, 0),
      budget: categories.reduce((s, c) => s + budgetFor(c, k), 0),
    }));
  }, [expenses, categories, selMonth]);

  /* ---- actions ---- */
  const addExpense = () => {
    const amt = parseFloat(fAmt);
    if (!fCat || !amt || amt <= 0 || !fDate) return;
    const personStr = fPerson.join(",");
    const entry = { id: uid(), cat: fCat, amount: amt, date: fDate, note: fNote.trim() };
    if (personStr) entry.person = personStr;
    if (fBank) { entry.bank = fBank; try { localStorage.setItem("ledger:lastBank", fBank); } catch {} }
    saveExps([entry, ...expenses]);
    if (fPerson.length > 0) {
      const next = { ...catPersonMap, [fCat]: fPerson };
      setCatPersonMap(next);
      try { localStorage.setItem("ledger:catPersonMap", JSON.stringify(next)); } catch {}
    }
    setFAmt(""); setFNote(""); setFPerson([]);
    setAddedFlash(true); setTimeout(() => setAddedFlash(false), 1600);
    if (fDate.slice(0, 7) !== selMonth) setSelMonth(fDate.slice(0, 7));
  };
  const delExpense = (id) => saveExps(expenses.filter((e) => e.id !== id));

  const startEdit = (e) => {
    setEditingId(e.id);
    setEditForm({ cat: e.cat, amount: String(e.amount), date: e.date, note: e.note || "", person: e.person || "", bank: e.bank || "" });
  };
  const cancelEdit = () => setEditingId(null);
  const saveEdit = () => {
    const amt = parseFloat(editForm.amount);
    if (!editForm.cat || !amt || amt <= 0 || !editForm.date) return;
    saveExps(expenses.map((e) => e.id === editingId
      ? { ...e, cat: editForm.cat, amount: amt, date: editForm.date, note: editForm.note.trim(), ...(editForm.person ? { person: editForm.person } : { person: undefined }), ...(editForm.bank ? { bank: editForm.bank } : { bank: undefined }) }
      : e
    ));
    setEditingId(null);
  };

  const backupData = () => {
    try {
      const data = {
        _meta: { app: "Manali's Ledger", exportedAt: new Date().toISOString(), version: CAT_VERSION },
        "ledger:categories": categories,
        "ledger:income": income,
        "ledger:expenses": expenses,
        "ledger:settings": { sym },
        "ledger:merchantMap": merchantMap,
        "ledger:stmts": stmts,
        "ledger:catPersonMap": catPersonMap,
        "ledger:catVersion": CAT_VERSION,
      };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "manali-ledger-backup-" + new Date().toISOString().slice(0, 10) + ".json";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      setBackupFlash(true); setTimeout(() => setBackupFlash(false), 1600);
    } catch (e) { console.error(e); }
  };

  const generateReport = () => {
    const fmt = (n) => sym + inr.format(Math.round(Math.abs(n || 0)));
    const mo = monthLabel(selMonth, { month: "long", year: "numeric" });
    const lines = [
      `📊 *Manali's Ledger — ${mo}*`,
      "",
      `💰 Income: ${fmt(totalIncome)}`,
      `📋 Budgeted: ${fmt(totalBudget)}`,
      `💸 Spent: ${fmt(totalSpent)}`,
      `🏦 Saved: ${fmt(net)} (${savingsRate.toFixed(0)}%)`,
      "",
      "*Category breakdown:*",
    ];
    grouped.forEach((g) => {
      const pct = g.budget > 0 ? Math.round((g.spent / g.budget) * 100) : null;
      const flag = g.spent > g.budget && g.budget > 0 ? " ⚠️" : "";
      lines.push(`  *${g.section}* — ${fmt(g.spent)}${g.budget > 0 ? ` / ${fmt(g.budget)} (${pct}%)` : ""}${flag}`);
      g.rows.filter((r) => r.spent > 0).forEach((r) => {
        const rPct = r.budget > 0 ? Math.round((r.spent / r.budget) * 100) : null;
        const rFlag = r.status === "over" ? " 🔴" : r.status === "caution" ? " 🟡" : "";
        lines.push(`    • ${r.name}: ${fmt(r.spent)}${r.budget > 0 ? ` / ${fmt(r.budget)} (${rPct}%)` : ""}${rFlag}`);
      });
    });
    if (overRows.length > 0) {
      lines.push("", `*⚠️ Over budget in ${overRows.length} categor${overRows.length === 1 ? "y" : "ies"}:*`);
      overRows.forEach((r) => lines.push(`  • ${r.name}: ${fmt(r.spent - r.budget)} over`));
    }
    lines.push("", `_Generated by Manali's Ledger · ${new Date().toLocaleDateString("en-IN")}_`);
    const text = lines.join("\n");
    try {
      navigator.clipboard.writeText(text).then(() => {
        setReportFlash(true); setTimeout(() => setReportFlash(false), 2500);
      });
    } catch { alert(text); }
  };

  const onImport = (newExpenses, newMap, bankSource) => {
    saveExps([...newExpenses, ...expenses]);
    if (newMap) { setMerchantMap(newMap); store.set(K_MAP, newMap); }
    if (bankSource && newExpenses[0]?.date) {
      const mk = newExpenses[0].date.slice(0, 7);
      const cur = stmts[mk] || [];
      if (!cur.includes(bankSource)) saveStmts({ ...stmts, [mk]: [...cur, bankSource] });
    }
    setImportOpen(false);
    if (newExpenses[0]?.date) setSelMonth(newExpenses[0].date.slice(0, 7));
  };

  const editCatAmount = (id, value) => {
    const v = parseFloat(value) || 0;
    saveCats(categories.map((c) => {
      if (c.id !== id) return c;
      const monthly = isFlat(c.monthly) ? flat(v) : c.monthly.map((x, i) => (i === mIdx(selMonth) ? v : x));
      return { ...c, monthly };
    }));
  };
  const editCatName = (id, name) => saveCats(categories.map((c) => (c.id === id ? { ...c, name } : c)));
  const editIncome = (id, value) => {
    const v = parseFloat(value) || 0;
    saveInc(income.map((l) => (l.id === id ? { ...l, monthly: flat(v) } : l)));
  };
  const addCategory = () =>
    saveCats([...categories, { id: uid(), name: "New category", section: "Lifestyle", recurring: true, monthly: flat(0) }]);
  const delCategory = (id) => {
    const c = catById[id];
    const n = expenses.filter((e) => e.cat === id).length;
    if (!window.confirm(n ? `Delete "${c.name}" and its ${n} logged expense${n > 1 ? "s" : ""}? Can't be undone.` : `Delete "${c.name}"?`)) return;
    saveCats(categories.filter((c) => c.id !== id));
    if (n) saveExps(expenses.filter((e) => e.cat !== id));
  };

  const loadSample = () => {
    const find = (nm) => categories.find((c) => c.name === nm)?.id;
    const base = selMonth + "-";
    const day = (d) => base + String(d).padStart(2, "0");
    const raw = [
      ["Grocery", 4200, 4, "DMart stock-up"],
      ["Grocery", 3800, 17, "Vegetables + dairy"],
      ["Grocery", 11500, 27, "Festive groceries"],
      ["Food & Travel", 9200, 9, "Work travel + meals"],
      ["Food & Travel", 6400, 14, "Weekend outing"],
      ["Medical", 5600, 11, "Consultation + pharmacy"],
      ["Holiday", 38000, 20, "Goa trip advance"],
      ["Shopping", 7200, 22, "Clothes"],
      ["Shopping", 3500, 6, "Home items"],
      ["Entertainment", 2400, 13, "Movie + dinner"],
      ["Bike", 1800, 8, "Servicing"],
      ["Parlour", 900, 16, "Salon"],
    ];
    const sample = raw
      .filter((r) => find(r[0]))
      .map((r) => ({ id: uid(), cat: find(r[0]), amount: r[1], date: day(r[2]), note: r[3] }));
    saveExps([...sample, ...expenses]);
  };

  if (loading) return (<div className="ledger-root"><Styles /><div className="loading">Opening your ledger…</div></div>);

  const selIdxLabel = monthLabel(selMonth);

  return (
    <div className="ledger-root">
      <Styles />

      <header className="mast">
        <div className="mast-title">
          <span className="mast-mark"><Wallet size={18} strokeWidth={2.2} /></span>
          <div>
            <h1>Manali's Ledger</h1>
            <p>FY 2026–27 · budget vs. spend, month by month</p>
          </div>
        </div>
        <div className="mast-controls">
          <div className="monthnav">
            <button aria-label="Previous month" onClick={() => setSelMonth(shiftMonth(selMonth, -1))}><ChevronLeft size={18} /></button>
            <span className="monthnav-label">{selIdxLabel}</span>
            <button aria-label="Next month" onClick={() => setSelMonth(shiftMonth(selMonth, 1))}><ChevronRight size={18} /></button>
          </div>
          <button className="btn-ghost" onClick={() => setImportOpen(true)}><Upload size={15} /> Import</button>
          <button className="btn-ghost" onClick={() => setManageOpen(true)}><SlidersHorizontal size={15} /> Budgets</button>
          <button className={`btn-ghost${view === "analysis" ? " btn-ghost-active" : ""}`} onClick={() => setView(v => v === "analysis" ? "dashboard" : "analysis")}><BarChart2 size={15} /> Analysis</button>
          <button className={`btn-ghost${backupFlash ? " btn-ghost-active" : ""}`} onClick={backupData} title="Download a full backup of your ledger as a JSON file"><Download size={15} /> {backupFlash ? "Saved!" : "Backup"}</button>
          <button className={`btn-ghost${reportFlash ? " btn-ghost-active" : ""}`} onClick={generateReport}><ArrowUpRight size={15} /> {reportFlash ? "Copied! 🎉" : "Share"}</button>
        </div>
      </header>

      {/* log */}
      <section className="panel logbar">
        <div className="panel-head"><h2>Log an expense</h2></div>
        <div className="logform">
          <select value={fCat} onChange={(e) => {
            const id = e.target.value; setFCat(id);
            const saved = catPersonMap[id]; setFPerson(saved ? [...saved] : []);
          }} aria-label="Category">
            {SECTIONS.map((sec) => {
              const opts = categories.filter((c) => c.section === sec);
              if (!opts.length) return null;
              return (<optgroup key={sec} label={sec}>{opts.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}</optgroup>);
            })}
            {categories.some((c) => !SECTIONS.includes(c.section)) && (
              <optgroup label="Other">{categories.filter((c) => !SECTIONS.includes(c.section)).map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}</optgroup>
            )}
          </select>
          <div className="amt-input"><span>{sym.trim()}</span>
            <input type="number" min="0" placeholder="Amount" value={fAmt} onChange={(e) => setFAmt(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addExpense()} />
          </div>
          <input type="date" value={fDate} onChange={(e) => setFDate(e.target.value)} aria-label="Date" />
          <select className="bank-select" value={fBank} onChange={(e) => setFBank(e.target.value)} aria-label="Account / card used">
            <option value="">&mdash; account &mdash;</option>
            {BANKS.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
          </select>
          <input type="text" placeholder="Note (optional)" value={fNote} onChange={(e) => setFNote(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addExpense()} />
          <button className={`btn-add${addedFlash ? " flash" : ""}`} onClick={addExpense}><Plus size={16} /> {addedFlash ? "Saved!" : "Add"}</button>
          {catById[fCat] && (
            <div className="person-row">
              <span className="person-label">For:</span>
              {["Sid", "Manali", "Saryu"].map((p) => (
                <button key={p} type="button"
                  className={`person-btn${fPerson.includes(p) ? " on" : ""}`}
                  onClick={() => setFPerson((prev) => prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p])}>
                  {p}
                </button>
              ))}
              {fPerson.length > 1 && <span className="split-hint">split {fPerson.length} ways</span>}
            </div>
          )}
        </div>
      </section>

      <StatementStatus stmts={stmts} selMonth={selMonth} onToggle={(key) => {
        const cur = stmts[selMonth] || [];
        const next = cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key];
        saveStmts({ ...stmts, [selMonth]: next });
      }} />

      {/* summary strip */}
      <section className="strip">
        <Stat label="Budgeted" value={money(totalBudget, sym)} />
        <Stat label="Spent" value={money(totalSpent, sym)} accent={usedPct > 100 ? "red" : "ink"} />
        <Stat label="Remaining" value={moneySigned(remaining, sym)} accent={remaining < 0 ? "red" : "teal"} />
        <Stat
          label={net < 0 ? "Overspent" : "Net saved"}
          value={moneySigned(net, sym)}
          accent={net < 0 ? "red" : "teal"}
          sub={totalIncome > 0 ? `${savingsRate.toFixed(0)}% savings rate` : null}
        />
      </section>

      <div className="usebar-wrap">
        <span className="usebar-label">
          {usedPct.toFixed(0)}% of {monthLabel(selMonth, { month: "short" })} budget spent
        </span>
        <div className="usebar">
          <div className="usebar-fill" style={{ width: `${Math.min(usedPct, 100)}%`, background: usedPct > 100 ? "var(--red)" : usedPct >= 80 ? "var(--amber)" : "var(--teal)" }} />
        </div>
        {usedPct > 100 && <span className="usebar-over num">+{(usedPct - 100).toFixed(0)}%</span>}
      </div>

      {overRows.length > 0 && (
        <div className="alert">
          <TriangleAlert size={17} strokeWidth={2.2} />
          <span>You went over in <strong>{overRows.length}</strong> {overRows.length > 1 ? "categories" : "category"} this month — <strong>{money(totalOver, sym)}</strong> beyond plan.</span>
        </div>
      )}

      {view === "analysis" ? (
        <AnalysisView grouped={grouped} sym={sym} selMonth={selMonth} expenses={expenses} categories={categories} catById={catById} />
      ) : (<>
      <div className="grid">
        {/* ledger */}
        <section className="panel ledger-panel">
          <div className="panel-head">
            <h2>Where it went</h2>
            <button className="toggle" onClick={() => setHideEmpty((v) => !v)}>
              {hideEmpty ? <EyeOff size={14} /> : <Eye size={14} />}
              {hideEmpty ? `Hiding ${hiddenCount} empty` : "Showing all"}
            </button>
          </div>

          {grouped.length === 0 && <div className="empty">Nothing budgeted or spent in {selIdxLabel}.</div>}

          {grouped.map((g) => {
            const secOver = g.spent > g.budget && g.budget > 0;
            return (
              <div className="sec" key={g.section}>
                <div className="sec-head">
                  <span className="sec-name">{g.section}</span>
                  <span className="sec-sub num">
                    <span className={secOver || g.budget === 0 ? "fig-over" : ""}>{money(g.spent, sym)}</span>
                    <span className="row-of">{g.budget > 0 ? ` / ${money(g.budget, sym)}` : " · unbudgeted"}</span>
                  </span>
                </div>
                <div className="rows">
                  {g.rows.map((r) => {
                    const w = widthForRatio(r.ratio === Infinity ? 1.6 : r.ratio);
                    const under = Math.min(w, BUDGET_POS);
                    const over = Math.max(0, w - BUDGET_POS);
                    const underColor = r.status === "caution" ? "var(--amber)" : r.status === "unbudgeted" ? "var(--red-soft)" : "var(--teal)";
                    const diff = r.budget > 0 ? r.spent - r.budget : r.spent;
                    return (
                      <div className="row" key={r.id}>
                        <div className="row-top">
                          <span className="row-name">{r.name}</span>
                          <span className="row-fig num">
                            <span className={r.status === "over" || r.status === "unbudgeted" ? "fig-over" : ""}>{money(r.spent, sym)}</span>
                            <span className="row-of">{r.budget > 0 ? ` / ${money(r.budget, sym)}` : " · no budget"}</span>
                          </span>
                        </div>
                        <div className="track">
                          {r.budget > 0 && <span className="track-marker" style={{ left: `${BUDGET_POS}%` }} />}
                          <span className="seg under" style={{ width: `${under}%`, background: underColor }} />
                          {over > 0 && <span className="seg over" style={{ left: `${BUDGET_POS}%`, width: `${over}%` }} />}
                        </div>
                        <div className="row-foot num">
                          {r.status === "over" && <span className="tag tag-red">{money(diff, sym)} over</span>}
                          {r.status === "unbudgeted" && <span className="tag tag-red">unbudgeted spend</span>}
                          {r.status === "caution" && <span className="tag tag-amber">{money(r.budget - r.spent, sym)} left</span>}
                          {r.status === "ok" && r.spent > 0 && <span className="tag tag-teal">{money(r.budget - r.spent, sym)} left</span>}
                          {r.status === "ok" && r.spent === 0 && <span className="tag tag-faint">nothing spent</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </section>

        {/* sidebar */}
        <aside className="side">
          <section className="panel">
            <div className="panel-head"><h2>Cash flow · {monthLabel(selMonth, { month: "short", year: "numeric" })}</h2></div>
            <div className="cf">
              <div className="cf-line"><span>Budget</span><span className="num">{money(totalBudget, sym)}</span></div>
              <div className="cf-line"><span>Spent</span><span className="num fig-over">− {money(totalSpent, sym)}</span></div>
              <div className="cf-line cf-net">
                <span>{remaining < 0 ? "Over budget" : "Remaining"}</span>
                <span className={`num ${remaining < 0 ? "fig-over" : "fig-good"}`}>{money(remaining, sym)}</span>
              </div>
              <p className="cf-note">
                {remaining >= 0
                  ? `${money(remaining, sym)} left in this month's budget.`
                  : `Over budget by ${money(-remaining, sym)} this month.`}
              </p>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head"><h2>6-month trend</h2></div>
            <div className="chart">
              <ResponsiveContainer width="100%" height={180}>
                <ComposedChart data={trend} margin={{ top: 6, right: 4, left: -14, bottom: 0 }}>
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted)" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: "var(--faint)" }} axisLine={false} tickLine={false}
                    tickFormatter={(v) => (v >= 100000 ? `${sym}${(v / 100000).toFixed(1)}L` : v >= 1000 ? `${sym}${Math.round(v / 1000)}k` : `${sym}${v}`)} />
                  <Tooltip cursor={{ fill: "rgba(0,0,0,0.04)" }}
                    contentStyle={{ borderRadius: 10, border: "1px solid var(--hairline)", fontSize: 12, fontFamily: "Inter, sans-serif" }}
                    formatter={(v, n) => [money(v, sym), n === "spent" ? "Spent" : "Budget"]} />
                  <Legend wrapperStyle={{ fontSize: 11, paddingTop: 4 }} iconType="plainline" />
                  <Bar dataKey="spent" name="Spent" radius={[4, 4, 0, 0]} maxBarSize={26}>
                    {trend.map((d, i) => (<Cell key={i} fill={d.budget > 0 && d.spent > d.budget ? "var(--red)" : "var(--teal)"} />))}
                  </Bar>
                  <Line dataKey="budget" name="Budget" stroke="var(--ink)" strokeWidth={1.5} strokeDasharray="4 3" dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <p className="chart-note">Dashed line is each month's planned budget — it shifts with your annual items (LIC, insurance, etc.). Bars turn red on months you ran over.</p>
          </section>

          {overRows.length > 0 && (
            <section className="panel">
              <div className="panel-head"><h2>Trim these first</h2></div>
              <ul className="overlist">
                {overRows.slice().sort((a, b) => (b.budget > 0 ? b.spent - b.budget : b.spent) - (a.budget > 0 ? a.spent - a.budget : a.spent)).map((r) => (
                  <li key={r.id}><span>{r.name}</span><span className="num fig-over"><ArrowUpRight size={13} strokeWidth={2.5} />{money(r.budget > 0 ? r.spent - r.budget : r.spent, sym)}</span></li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>

      {/* entries */}
      <section className="panel">
        <div className="panel-head">
          <h2>{monthLabel(selMonth, { month: "long" })} entries</h2>
          {monthExpenses.length === 0 && expenses.length === 0 && (<button className="btn-sample" onClick={loadSample}><Sparkles size={14} /> Load sample month</button>)}
        </div>
        {monthExpenses.length > 0 && (
          <div className="entry-search">
            <Search size={15} />
            <input
              type="text"
              value={entrySearch}
              onChange={(ev) => setEntrySearch(ev.target.value)}
              placeholder="Search this month — category, note, account or amount"
              aria-label="Search entries"
            />
            {entrySearch && (
              <button className="icon-btn" aria-label="Clear search" onClick={() => setEntrySearch("")}><X size={14} /></button>
            )}
          </div>
        )}
        {monthExpenses.length === 0 ? (
          <div className="empty">No expenses logged for this month yet.</div>
        ) : (() => {
          const q = entrySearch.trim().toLowerCase();
          const filtered = monthExpenses.filter((e) => {
            if (!q) return true;
            const bankLbl = BANKS.find((b) => b.key === e.bank)?.label || (e.src === "import" ? e.bank : "");
            const hay = [
              catById[e.cat]?.name || "Uncategorised",
              e.note || "",
              bankLbl || "",
              e.person || "",
              String(e.amount),
            ].join(" ").toLowerCase();
            return hay.includes(q);
          });
          if (filtered.length === 0) {
            return <div className="empty">No entries match “{entrySearch}”.</div>;
          }
          return (
          <ul className="entries">
            {filtered.slice().sort((a, b) => b.date.localeCompare(a.date)).map((e) => {
              if (editingId === e.id) {
                return (
                  <li key={e.id} className="en-edit">
                    <select className="en-edit-cat" value={editForm.cat} onChange={(ev) => setEditForm({ ...editForm, cat: ev.target.value })}>
                      {SECTIONS.map((sec) => {
                        const opts = categories.filter((c) => c.section === sec);
                        if (!opts.length) return null;
                        return (<optgroup key={sec} label={sec}>{opts.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}</optgroup>);
                      })}
                    </select>
                    <div className="amt-input sm en-edit-amt">
                      <span>{sym.trim()}</span>
                      <input type="number" min="0" value={editForm.amount} onChange={(ev) => setEditForm({ ...editForm, amount: ev.target.value })} />
                    </div>
                    <input className="en-edit-date" type="date" value={editForm.date} onChange={(ev) => setEditForm({ ...editForm, date: ev.target.value })} />
                    <select className="en-edit-bank" value={editForm.bank || ""} onChange={(ev) => setEditForm({ ...editForm, bank: ev.target.value })} aria-label="Account">
                      <option value="">&mdash; account &mdash;</option>
                      {BANKS.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
                    </select>
                    <input className="en-edit-note" type="text" placeholder="Note" value={editForm.note} onChange={(ev) => setEditForm({ ...editForm, note: ev.target.value })} onKeyDown={(ev) => ev.key === "Enter" && saveEdit()} />
                    <div className="en-edit-btns">
                      <button className="icon-btn" aria-label="Save" onClick={saveEdit}><Check size={14} strokeWidth={2.5} style={{ color: "var(--teal)" }} /></button>
                      <button className="icon-btn" aria-label="Cancel" onClick={cancelEdit}><X size={14} /></button>
                    </div>
                  </li>
                );
              }
              return (
                <li key={e.id}>
                  <span className="en-date num">{e.date.slice(8, 10)} {monthLabel(e.date.slice(0, 7), { month: "short" })}</span>
                  <span className="en-cat">{catById[e.cat]?.name || "Uncategorised"}</span>
                  <span className="en-bank">{BANKS.find(b => b.key === e.bank)?.label || (e.src === "import" ? e.bank : "—")}</span>
                  <span className="en-note">{e.note || "—"}{e.person && e.person.split(",").map((p) => <span key={p} className="person-tag">{p}</span>)}</span>
                  <span className="en-amt num">{money(e.amount, sym)}</span>
                  <button className="en-del" aria-label="Edit entry" onClick={() => startEdit(e)}><Pencil size={13} /></button>
                  <button className="en-del" aria-label="Delete entry" onClick={() => delExpense(e.id)}><Trash2 size={14} /></button>
                </li>
              );
            })}
          </ul>
          );
        })()}
      </section>

      </>)}

      {importOpen && (
        <ImportWizard categories={categories} sym={sym} merchantMap={merchantMap} existing={expenses}
          onClose={() => setImportOpen(false)} onImport={onImport} />
      )}

      <footer className="foot">Manali's Ledger · FY 2026–27 · everything you log is saved on this device.</footer>

      {/* drawer */}
      {manageOpen && (
        <div className="scrim" onClick={() => setManageOpen(false)}>
          <div className="drawer" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-head">
              <h2>Budgets</h2>
              <button className="icon-btn" aria-label="Close" onClick={() => setManageOpen(false)}><X size={18} /></button>
            </div>
            <p className="drawer-hint">Editing amounts for <strong>{selIdxLabel}</strong>. Flat budgets update every month; budgets that vary month-to-month update just this one.</p>

            <div className="cur-row">
              <span>Currency</span>
              <div className="cur-pills">{CURRENCIES.map((c) => (<button key={c} className={c === sym ? "cur on" : "cur"} onClick={() => saveSym(c)}>{c.trim()}</button>))}</div>
            </div>

            {SECTIONS.map((sec) => {
              const list = categories.filter((c) => c.section === sec);
              if (!list.length) return null;
              return (
                <div className="cat-list" key={sec}>
                  <div className="cat-head"><span>{sec}</span><span>Budget</span><span /></div>
                  {list.map((c) => (
                    <div className="cat-edit" key={c.id}>
                      <input value={c.name} onChange={(e) => editCatName(c.id, e.target.value)} />
                      <div className="amt-input sm"><span>{sym.trim()}</span><input type="number" min="0" value={c.monthly[mIdx(selMonth)] || 0} onChange={(e) => editCatAmount(c.id, e.target.value)} /></div>
                      <button className="icon-btn danger" aria-label="Delete" onClick={() => delCategory(c.id)}><Trash2 size={15} /></button>
                    </div>
                  ))}
                </div>
              );
            })}

            <button className="btn-ghost full" onClick={addCategory}><Plus size={15} /> Add category</button>
            <div className="drawer-total"><span>Total budget · {monthLabel(selMonth, { month: "short" })}</span><strong className="num">{money(totalBudget, sym)}</strong></div>
            <button className="btn-add full" onClick={() => setManageOpen(false)}><Check size={16} /> Done</button>
          </div>
        </div>
      )}
    </div>
  );
}

function StatementStatus({ stmts, selMonth, onToggle }) {
  const uploaded = new Set(stmts[selMonth] || []);
  const missing = BANKS.filter((b) => !uploaded.has(b.key));
  const allDone = missing.length === 0;
  return (
    <section className={`panel stmt-panel${allDone ? " stmt-done" : ""}`}>
      <div className="stmt-head">
        {allDone
          ? <><Check size={15} strokeWidth={2.4} className="stmt-icon-ok" /><span>All statements uploaded for {monthLabel(selMonth, { month: "long", year: "numeric" })}</span></>
          : <><TriangleAlert size={15} strokeWidth={2.2} className="stmt-icon-warn" /><span><strong>{missing.length}</strong> statement{missing.length > 1 ? "s" : ""} missing for {monthLabel(selMonth, { month: "long", year: "numeric" })} — mark uploaded once done</span></>
        }
      </div>
      <div className="stmt-list">
        {BANKS.map((b) => {
          const done = uploaded.has(b.key);
          return (
            <button key={b.key} className={`stmt-item${done ? " done" : ""}`} onClick={() => onToggle(b.key)}>
              <span className={`stmt-check${done ? " on" : ""}`}>{done ? <Check size={11} strokeWidth={2.5} /> : null}</span>
              {b.label}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function AnalysisView({ grouped, sym, selMonth, expenses = [], categories = [], catById = {} }) {
  const label = (k) => { const [y, m] = k.split("-").map(Number); return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" }); };
  const fmtIN = (n) => `${sym}${new Intl.NumberFormat("en-IN").format(Math.round(n || 0))}`;
  const bankLabel = (k) => BANKS.find((b) => b.key === k)?.label || (k || "Unassigned");

  const monthExp = useMemo(
    () => expenses.filter((e) => e.date.slice(0, 7) === selMonth),
    [expenses, selMonth]
  );

  /* account-wise (this month) */
  const acctData = useMemo(() => {
    const m = {};
    monthExp.forEach((e) => { const k = e.bank || "__none__"; m[k] = (m[k] || 0) + e.amount; });
    return Object.entries(m)
      .map(([k, v]) => ({ name: k === "__none__" ? "Unassigned" : bankLabel(k), spent: Math.round(v) }))
      .sort((a, b) => b.spent - a.spent);
  }, [monthExp]);
  const acctTotal = acctData.reduce((s, d) => s + d.spent, 0);

  /* person-wise (this month); shared entries split equally */
  const personData = useMemo(() => {
    const m = {};
    monthExp.forEach((e) => {
      const ppl = (e.person || "").split(",").map((x) => x.trim()).filter(Boolean);
      if (!ppl.length) { m.Untagged = (m.Untagged || 0) + e.amount; }
      else { const share = e.amount / ppl.length; ppl.forEach((p) => { m[p] = (m[p] || 0) + share; }); }
    });
    return Object.entries(m)
      .map(([k, v]) => ({ name: k, spent: Math.round(v) }))
      .sort((a, b) => b.spent - a.spent);
  }, [monthExp]);
  const personTotal = personData.reduce((s, d) => s + d.spent, 0);

  /* month-over-month across the fiscal year */
  const momData = useMemo(() => {
    const keys = [];
    for (let k = FY_START; k <= FY_END; k = shiftMonth(k, 1)) keys.push(k);
    return keys.map((k) => ({
      key: k,
      name: monthLabel(k, { month: "short" }),
      spent: Math.round(expenses.filter((e) => e.date.slice(0, 7) === k).reduce((s, e) => s + e.amount, 0)),
      budget: Math.round(categories.reduce((s, c) => s + budgetFor(c, k), 0)),
    }));
  }, [expenses, categories]);
  const PERSON_COLORS = { Sid: "var(--teal)", Manali: "#c084fc", Saryu: "var(--amber)", Untagged: "var(--hairline)" };

  return (
    <div className="analysis-wrap">
      <div className="panel-head" style={{ marginBottom: 10 }}>
        <h2 style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 18, fontWeight: 700, margin: 0 }}>
          Analysis · {label(selMonth)}
        </h2>
      </div>

      {/* Month-over-month trend (whole FY) */}
      <div className="panel analysis-panel">
        <div className="analysis-sec-head">
          <span className="sec-name">Month over month · FY 2026&ndash;27</span>
          <span className="sec-sub num" style={{ fontSize: 12, color: "var(--faint)" }}>spent vs budget</span>
        </div>
        <ResponsiveContainer width="100%" height={230}>
          <ComposedChart data={momData} margin={{ top: 8, right: 16, left: 4, bottom: 4 }}>
            <XAxis dataKey="name" tick={{ fontSize: 11, fill: "var(--muted)", fontFamily: "Inter,sans-serif" }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: "var(--faint)", fontFamily: "Inter,sans-serif" }} axisLine={false} tickLine={false} width={44}
              tickFormatter={(v) => v >= 1000 ? `${Math.round(v / 1000)}k` : v} />
            <Tooltip contentStyle={{ borderRadius: 10, border: "1px solid var(--hairline)", fontSize: 12, fontFamily: "Inter,sans-serif" }}
              formatter={(v, n) => [fmtIN(v), n === "spent" ? "Spent" : "Budget"]} />
            <Legend wrapperStyle={{ fontSize: 12, fontFamily: "Inter,sans-serif" }} />
            <Bar dataKey="spent" name="Spent" radius={[4, 4, 0, 0]} maxBarSize={26}>
              {momData.map((d, i) => (
                <Cell key={i} fill={d.spent > d.budget && d.budget > 0 ? "var(--red)" : d.key === selMonth ? "var(--ink)" : "var(--teal)"} />
              ))}
            </Bar>
            <Line dataKey="budget" name="Budget" type="monotone" stroke="var(--muted)" strokeWidth={1.5} strokeDasharray="4 4" dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Account-wise breakdown (this month) */}
      <div className="panel analysis-panel">
        <div className="analysis-sec-head">
          <span className="sec-name">By account · {label(selMonth)}</span>
          <span className="sec-sub num" style={{ fontSize: 12, color: "var(--faint)" }}>{fmtIN(acctTotal)}</span>
        </div>
        {acctData.length === 0 ? (
          <div className="empty" style={{ padding: "14px 0" }}>No spending logged this month.</div>
        ) : (
          <ResponsiveContainer width="100%" height={acctData.length * 40 + 20}>
            <BarChart data={acctData} layout="vertical" margin={{ top: 4, right: 24, left: 4, bottom: 4 }} barCategoryGap="30%">
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 12, fill: "var(--ink)", fontFamily: "Inter,sans-serif" }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ borderRadius: 10, border: "1px solid var(--hairline)", fontSize: 12, fontFamily: "Inter,sans-serif" }}
                formatter={(v) => [fmtIN(v), "Spent"]} />
              <Bar dataKey="spent" radius={[0, 4, 4, 0]} maxBarSize={12}>
                {acctData.map((d, i) => (
                  <Cell key={i} fill={d.name === "Unassigned" ? "var(--hairline)" : "var(--teal)"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Person-wise breakdown (this month) */}
      <div className="panel analysis-panel">
        <div className="analysis-sec-head">
          <span className="sec-name">By person · {label(selMonth)}</span>
          <span className="sec-sub num" style={{ fontSize: 12, color: "var(--faint)" }}>{fmtIN(personTotal)}</span>
        </div>
        {personData.length === 0 ? (
          <div className="empty" style={{ padding: "14px 0" }}>No spending logged this month.</div>
        ) : (
          <ResponsiveContainer width="100%" height={personData.length * 44 + 20}>
            <BarChart data={personData} layout="vertical" margin={{ top: 4, right: 24, left: 4, bottom: 4 }} barCategoryGap="28%">
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 12, fill: "var(--ink)", fontFamily: "Inter,sans-serif" }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ borderRadius: 10, border: "1px solid var(--hairline)", fontSize: 12, fontFamily: "Inter,sans-serif" }}
                formatter={(v) => [fmtIN(v), "Spent"]} />
              <Bar dataKey="spent" radius={[0, 4, 4, 0]} maxBarSize={14}>
                {personData.map((d, i) => (
                  <Cell key={i} fill={PERSON_COLORS[d.name] || "var(--teal)"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
        <div className="imp-note" style={{ marginTop: 6 }}><Info size={13} /> Entries tagged to more than one person are split equally.</div>
      </div>
      {grouped.map((g) => {
        const data = g.rows.map((r) => ({
          name: r.name.length > 18 ? r.name.slice(0, 17) + "…" : r.name,
          spent: Math.round(r.spent),
          budget: Math.round(r.budget),
        }));
        const maxVal = Math.max(...data.map((d) => Math.max(d.spent, d.budget)), 1);
        return (
          <div className="panel analysis-panel" key={g.section}>
            <div className="analysis-sec-head">
              <span className="sec-name">{g.section}</span>
              <span className="sec-sub num" style={{ fontSize: 12 }}>
                <span style={{ color: g.spent > g.budget && g.budget > 0 ? "var(--red)" : "inherit" }}>
                  {sym}{new Intl.NumberFormat("en-IN").format(Math.round(g.spent))}
                </span>
                {g.budget > 0 && <span style={{ color: "var(--faint)" }}> / {sym}{new Intl.NumberFormat("en-IN").format(Math.round(g.budget))}</span>}
              </span>
            </div>
            <ResponsiveContainer width="100%" height={data.length * 44 + 20}>
              <BarChart data={data} layout="vertical" margin={{ top: 4, right: 24, left: 4, bottom: 4 }} barCategoryGap="28%">
                <XAxis type="number" domain={[0, maxVal]} hide />
                <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 12, fill: "var(--ink)", fontFamily: "Inter,sans-serif" }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ borderRadius: 10, border: "1px solid var(--hairline)", fontSize: 12, fontFamily: "Inter,sans-serif" }}
                  formatter={(v, n) => [`${sym}${new Intl.NumberFormat("en-IN").format(v)}`, n === "spent" ? "Spent" : "Budget"]} />
                <Bar dataKey="budget" name="budget" radius={[0, 4, 4, 0]} maxBarSize={10} fill="var(--hairline)" />
                <Bar dataKey="spent" name="spent" radius={[0, 4, 4, 0]} maxBarSize={10}>
                  {data.map((d, i) => (
                    <Cell key={i} fill={d.spent > d.budget && d.budget > 0 ? "var(--red)" : d.spent >= d.budget * 0.8 ? "var(--amber)" : "var(--teal)"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        );
      })}
    </div>
  );
}

function Stat({ label, value, accent = "ink", sub = null }) {
  const color = accent === "red" ? "var(--red)" : accent === "teal" ? "var(--teal)" : "var(--ink)";
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value num" style={{ color }}>{value}</span>
      {sub && <span className="stat-sub">{sub}</span>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Statement importer                                                 */
/* ------------------------------------------------------------------ */
const MONTHS = { JAN:1, FEB:2, MAR:3, APR:4, MAY:5, JUN:6, JUL:7, AUG:8, SEP:9, OCT:10, NOV:11, DEC:12 };
const pad2 = (n) => String(n).padStart(2, "0");
function parseAmount(v) {
  if (v == null) return NaN;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  return isNaN(n) ? NaN : n;
}
function parseDate(str, fmt) {
  if (str == null || str === "") return null;
  const s = String(str).trim();
  const iso = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/);
  if (iso) return `${iso[1]}-${pad2(iso[2])}-${pad2(iso[3])}`;
  const parts = s.split(/[\s\/\-.,]+/).filter(Boolean);
  const monTok = parts.find((p) => MONTHS[p.slice(0, 3).toUpperCase()]);
  let d, m, y;
  if (monTok) {
    m = MONTHS[monTok.slice(0, 3).toUpperCase()];
    const nums = parts.filter((p) => /^\d+$/.test(p));
    d = parseInt(nums[0], 10); y = parseInt(nums[1] || "", 10);
  } else if (parts.length >= 3) {
    const a = parseInt(parts[0], 10), b = parseInt(parts[1], 10), c = parseInt(parts[2], 10);
    if (fmt === "MDY") { m = a; d = b; y = c; }
    else if (fmt === "YMD") { y = a; m = b; d = c; }
    else { d = a; m = b; y = c; }
  } else {
    const dt = new Date(s);
    return isNaN(dt) ? null : `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
  }
  if (y != null && y < 100) y += 2000;
  if (!d || !m || !y || m > 12 || d > 31) return null;
  return `${y}-${pad2(m)}-${pad2(d)}`;
}
function normMerchant(desc) {
  return (desc || "").toUpperCase().replace(/[^A-Z ]/g, " ").split(/\s+/).filter((w) => w.length > 2).slice(0, 3).join(" ");
}
function colLabel(i, h) {
  const L = i < 26 ? String.fromCharCode(65 + i) : "C" + i;
  const t = String(h || "").trim();
  return t ? `${L} · ${t.slice(0, 22)}` : L;
}
function detect(rows) {
  let hr = 0;
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const j = (rows[i] || []).join(" ").toLowerCase();
    if (/date/.test(j) && /(amount|debit|withdrawal|credit|deposit|balance)/.test(j)) { hr = i; break; }
  }
  const H = (rows[hr] || []).map((x) => String(x || "").toLowerCase());
  const find = (re) => H.findIndex((h) => re.test(h));
  const date = find(/date/);
  const desc = find(/narration|description|particular|details|remark/);
  const debit = find(/debit|withdrawal|paid out/);
  const credit = find(/credit|deposit|paid in/);
  const amount = find(/amount/);
  if (debit < 0 && amount >= 0) return { hr, mode: "single", m: { date, desc, debit: -1, credit, amount } };
  return { hr, mode: "split", m: { date, desc, debit, credit, amount: -1 } };
}

function Field({ label, children }) {
  return (<label className="imp-field"><span>{label}</span>{children}</label>);
}
function ColSelect({ value, opts, onChange, allowNone }) {
  return (
    <select value={value} onChange={(e) => onChange(parseInt(e.target.value, 10))}>
      <option value={-1}>{allowNone ? "— none —" : "— select —"}</option>
      {opts.map((o) => (<option key={o.i} value={o.i}>{o.label}</option>))}
    </select>
  );
}
function CatSelect({ categories, value, onChange, hint }) {
  return (
    <div className="catsel">
      <select className={value ? "" : "needpick"} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">— choose category —</option>
        {SECTIONS.map((sec) => {
          const opts = categories.filter((c) => c.section === sec);
          if (!opts.length) return null;
          return (<optgroup key={sec} label={sec}>{opts.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}</optgroup>);
        })}
      </select>
      {hint && <span className="catsel-hint">{hint}</span>}
    </div>
  );
}

const fileToB64 = (f) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = () => rej(r.error); r.readAsDataURL(f); });
function salvageJSON(text) {
  if (!text) return [];
  let s = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  const i = s.indexOf("["); if (i < 0) return [];
  s = s.slice(i);
  try { return JSON.parse(s); } catch {}
  const last = s.lastIndexOf("}");
  if (last > 0) { try { return JSON.parse(s.slice(0, last + 1) + "]"); } catch {} }
  return [];
}
const toISODate = (d) => { const s = String(d || "").trim(); if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s; return parseDate(s, "DMY") || ""; };
async function extractViaAPI(b64, media, isPdf) {
  const block = isPdf
    ? { type: "document", source: { type: "base64", media_type: media, data: b64 } }
    : { type: "image", source: { type: "base64", media_type: media, data: b64 } };
  const prompt = "Extract EVERY transaction from this bank or credit-card statement. Return ONLY a JSON array — no prose, no markdown fences. Each element must be {\"date\":\"YYYY-MM-DD\",\"description\":\"merchant or narration\",\"amount\":<positive number>,\"kind\":\"debit\"|\"credit\"}. kind=\"debit\" = money spent, withdrawn, or a purchase; kind=\"credit\" = money received, a refund, or a payment toward the card. Infer the year from the statement. Exclude opening/closing balances and summary totals. If you cannot read it, return [].";
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 1000, messages: [{ role: "user", content: [block, { type: "text", text: prompt }] }] }),
  });
  if (!res.ok) throw new Error("api " + res.status);
  const json = await res.json();
  const text = (json.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  return salvageJSON(text)
    .filter((t) => t && (t.kind ? t.kind === "debit" : true) && Number(t.amount) > 0)
    .map((t) => ({ date: toISODate(t.date), description: String(t.description || ""), amount: Math.abs(Number(t.amount)) }));
}

function ImportWizard({ categories, sym, merchantMap, existing, onClose, onImport }) {
  const [step, setStep] = useState("upload");
  const [viaAPI, setViaAPI] = useState(false);
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState([]);
  const [headerRow, setHeaderRow] = useState(0);
  const [map, setMap] = useState({ date: -1, desc: -1, debit: -1, credit: -1, amount: -1 });
  const [amountMode, setAmountMode] = useState("split");
  const [singleSign, setSingleSign] = useState("pos");
  const [dateFmt, setDateFmt] = useState("DMY");
  const [txns, setTxns] = useState([]);
  const [assign, setAssign] = useState({});
  const [include, setInclude] = useState({});
  const [remember, setRemember] = useState(false);
  const [search, setSearch] = useState("");
  const [onlyUnassigned, setOnlyUnassigned] = useState(false);
  const [bulkCat, setBulkCat] = useState("");
  const [err, setErr] = useState("");
  const [sbiPwd, setSbiPwd] = useState(() => { try { return localStorage.getItem("ledger:sbiPwd") || ""; } catch { return ""; } });
  const [ccPwd, setCcPwd] = useState(() => { try { return localStorage.getItem("ledger:ccPwd") || ""; } catch { return ""; } });
  const [bomPwd, setBomPwd] = useState(() => { try { return localStorage.getItem("ledger:bomPwd") || ""; } catch { return ""; } });
  const [hdfcBankPwd, setHdfcBankPwd] = useState(() => { try { return localStorage.getItem("ledger:hdfcBankPwd") || ""; } catch { return ""; } });
  const [ccCardType, setCcCardType] = useState("hdfc_regalia");
  const [sbiOwner, setSbiOwner] = useState("sbi_srp");
  const [genericBank, setGenericBank] = useState("");
  const [bankSource, setBankSource] = useState(null);
  const [dup, setDup] = useState({});
  const [personAssign, setPersonAssign] = useState({});
  const dupKey = (date, amount, desc) => `${date}|${Math.round(amount)}|${normMerchant(desc)}`;
  const existingKeys = useMemo(() => new Set((existing || []).map((e) => dupKey(e.date, e.amount, e.note))), [existing]);
  const catById = useMemo(() => Object.fromEntries((categories || []).map((c) => [c.id, c])), [categories]);

  const toReview = (out, fromAPI) => {
    if (!out.length) { setErr("No expense transactions were found. For tabular files, check the column mapping; for PDFs, try a clearer copy or a CSV/Excel export."); if (fromAPI) setStep("upload"); return; }
    const asg = {}, inc = {}, dp = {};
    out.forEach((t) => {
      const isDup = existingKeys.has(dupKey(t.date, t.amount, t.desc));
      dp[t.key] = isDup; inc[t.key] = !isDup;
      const mk = normMerchant(t.desc);
      if (mk && merchantMap[mk]) asg[t.key] = merchantMap[mk];
    });
    setTxns(out); setAssign(asg); setInclude(inc); setDup(dp); setPersonAssign({}); setViaAPI(!!fromAPI); setErr(""); setStep("review");
  };

  const handleFile = async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    if (!genericBank) { e.target.value = ""; setErr("Pick which bank / card this file is from first."); return; }
    setErr(""); setFileName(f.name);
    setBankSource(genericBank);
    const nm = f.name.toLowerCase();
    const isDoc = nm.endsWith(".pdf") || /\.(png|jpe?g|webp)$/.test(nm);
    try {
      if (isDoc) {
        setStep("loading");
        const b64 = await fileToB64(f);
        const isPdf = nm.endsWith(".pdf");
        const media = isPdf ? "application/pdf" : nm.endsWith(".png") ? "image/png" : nm.endsWith(".webp") ? "image/webp" : "image/jpeg";
        const list = await extractViaAPI(b64, media, isPdf);
        toReview(list.map((t, i) => ({ key: "a" + i, date: t.date, desc: t.description.trim(), amount: t.amount })), true);
        return;
      }
      let parsed = [];
      if (nm.endsWith(".csv") || nm.endsWith(".txt")) {
        const text = await f.text();
        parsed = Papa.parse(text, { skipEmptyLines: "greedy" }).data;
      } else {
        const buf = await f.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        parsed = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });
      }
      parsed = parsed.filter((r) => Array.isArray(r) && r.some((c) => String(c).trim() !== ""));
      if (!parsed.length) { setErr("Couldn't read any rows from that file."); return; }
      const d = detect(parsed);
      setRows(parsed); setHeaderRow(d.hr); setMap(d.m); setAmountMode(d.mode); setStep("map");
    } catch (ex) {
      console.error(ex);
      setErr(isDoc
        ? "Couldn't read that PDF/image — the extraction step failed. Try again, or use a CSV/Excel export from your bank."
        : "That file couldn't be parsed. Try a CSV or XLSX export from your bank.");
      setStep("upload");
    }
  };


  const handleSBIFile = async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    e.target.value = "";
    setErr(""); setFileName(f.name);
    if (!sbiPwd.trim()) { setErr("Enter your SBI statement password first."); return; }
    try { localStorage.setItem("ledger:sbiPwd", sbiPwd); } catch {}
    setStep("loading");
    try {
      const b64 = await fileToB64(f);
      const res = await fetch("/api/decrypt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file: b64, password: sbiPwd.trim() }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Decryption failed");
      const list = data.transactions.map((t, i) => ({
        key: "sbi" + i, date: t.date, desc: t.description, amount: t.amount,
      }));
      setBankSource(sbiOwner);
      toReview(list, false);
    } catch (ex) {
      console.error(ex);
      setErr("Could not decrypt: " + (ex.message || "check password and try again."));
      setStep("upload");
    }
  };

  const handleUBIFile = async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    e.target.value = "";
    setErr(""); setFileName(f.name);
    setStep("loading");
    try {
      const b64 = await fileToB64(f);
      const res = await fetch("/api/decrypt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file: b64, password: "", bank: "ubi" }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Parsing failed");
      const list = data.transactions.map((t, i) => ({
        key: "ubi" + i, date: t.date, desc: t.description, amount: t.amount,
      }));
      setBankSource("ubi");
      toReview(list, false);
    } catch (ex) {
      console.error(ex);
      setErr("Could not parse UBI statement: " + (ex.message || "try again."));
      setStep("upload");
    }
  };

  const handleBOMFile = async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    e.target.value = "";
    setErr(""); setFileName(f.name);
    if (!bomPwd.trim()) { setErr("Enter your Bank of Maharashtra statement password first."); return; }
    try { localStorage.setItem("ledger:bomPwd", bomPwd); } catch {}
    setStep("loading");
    try {
      const b64 = await fileToB64(f);
      const res = await fetch("/api/decrypt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file: b64, password: bomPwd.trim(), bank: "bom" }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Decryption failed");
      const list = data.transactions.map((t, i) => ({
        key: "bom" + i, date: t.date, desc: t.description, amount: t.amount,
      }));
      setBankSource("bom");
      toReview(list, false);
    } catch (ex) {
      console.error(ex);
      setErr("Could not decrypt: " + (ex.message || "check password and try again."));
      setStep("upload");
    }
  };

  const handleHDFCBankFile = async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    e.target.value = "";
    setErr(""); setFileName(f.name);
    if (!hdfcBankPwd.trim()) { setErr("Enter your HDFC Bank statement password first."); return; }
    try { localStorage.setItem("ledger:hdfcBankPwd", hdfcBankPwd); } catch {}
    setStep("loading");
    try {
      const b64 = await fileToB64(f);
      const res = await fetch("/api/decrypt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file: b64, password: hdfcBankPwd.trim(), bank: "hdfc_bank" }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Decryption failed");
      const list = data.transactions.map((t, i) => ({
        key: "hdfcbank" + i, date: t.date, desc: t.description, amount: t.amount,
      }));
      setBankSource("hdfc_bank");
      toReview(list, false);
    } catch (ex) {
      console.error(ex);
      setErr("Could not decrypt: " + (ex.message || "check password and try again."));
      setStep("upload");
    }
  };

  const handleCCFile = async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    e.target.value = "";
    setErr(""); setFileName(f.name);
    if (!ccPwd.trim()) { setErr("Enter your credit card statement password first."); return; }
    try { localStorage.setItem("ledger:ccPwd", ccPwd); } catch {}
    setStep("loading");
    try {
      const b64 = await fileToB64(f);
      const res = await fetch("/api/decrypt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file: b64, password: ccPwd.trim(), bank: "hdfc_cc" }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Decryption failed");
      const list = data.transactions.map((t, i) => ({
        key: "cc" + i, date: t.date, desc: t.description, amount: t.amount,
      }));
      setBankSource(ccCardType);
      toReview(list, false);
    } catch (ex) {
      console.error(ex);
      setErr("Could not decrypt: " + (ex.message || "check password and try again."));
      setStep("upload");
    }
  };

  const headerCells = rows[headerRow] || [];
  const colOpts = headerCells.map((h, i) => ({ i, label: colLabel(i, h) }));

  const buildTxns = () => {
    const out = [];
    for (let r = headerRow + 1; r < rows.length; r++) {
      const row = rows[r]; if (!row) continue;
      const date = parseDate(row[map.date], dateFmt);
      const desc = String(map.desc >= 0 ? (row[map.desc] ?? "") : "").trim();
      let amount = NaN;
      if (amountMode === "split") amount = parseAmount(row[map.debit]);
      else { const a = parseAmount(row[map.amount]); if (!isNaN(a)) amount = (singleSign === "pos" ? a : -a); }
      if (isNaN(amount) || amount <= 0) continue;
      if (!desc && !date) continue;
      out.push({ key: r, date, desc, amount });
    }
    toReview(out, false);
  };

  const visible = txns.filter((t) => {
    if (search && !t.desc.toLowerCase().includes(search.toLowerCase())) return false;
    if (onlyUnassigned && assign[t.key]) return false;
    return true;
  });
  const assignedCount = txns.filter((t) => include[t.key] && assign[t.key]).length;
  const importTotal = txns.filter((t) => include[t.key] && assign[t.key]).reduce((s, t) => s + t.amount, 0);
  const dupCount = txns.filter((t) => dup[t.key]).length;

  const applyBulk = () => {
    if (!bulkCat) return;
    const next = { ...assign };
    visible.forEach((t) => { next[t.key] = bulkCat; });
    setAssign(next);
  };

  const doImport = () => {
    const picked = txns.filter((t) => include[t.key] && assign[t.key]);
    if (!picked.length) return;
    const expenses = picked.map((t) => ({
      id: uid(), cat: assign[t.key], amount: t.amount,
      date: t.date || new Date().toISOString().slice(0, 10),
      note: t.desc || "Imported", src: "import", bank: bankSource,
      ...(personAssign[t.key] && { person: personAssign[t.key] }),
    }));
    let newMap = null;
    if (remember) {
      newMap = { ...merchantMap };
      picked.forEach((t) => { const mk = normMerchant(t.desc); if (mk) newMap[mk] = assign[t.key]; });
    }
    onImport(expenses, newMap, bankSource);
  };

  return (
    <div className="scrim" onClick={onClose}>
      <div className="imp" onClick={(e) => e.stopPropagation()}>
        <div className="imp-head">
          <h2>Import statement</h2>
          <button className="icon-btn" aria-label="Close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="imp-steps">
          <span className={step === "upload" ? "on" : ""}>1 · File</span><ArrowRight size={13} />
          <span className={step === "map" ? "on" : ""}>2 · Columns</span><ArrowRight size={13} />
          <span className={step === "review" ? "on" : ""}>3 · Categorise</span>
        </div>

        {err && <div className="imp-err"><Info size={15} /> {err}</div>}

        {step === "upload" && (
          <div className="imp-body">
            <div className="sbi-row" style={{ flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
              <span className="person-label" style={{ fontWeight: 600 }}>Account for this file:</span>
              <select className="sbi-pwd" style={{ flex: "0 0 auto", width: "auto" }} value={genericBank} onChange={(e) => setGenericBank(e.target.value)}>
                <option value="">— select bank / card —</option>
                {BANKS.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
              </select>
            </div>
            <label className="dropzone" style={!genericBank ? { opacity: .45, pointerEvents: "none" } : {}}>
              <FileSpreadsheet size={26} strokeWidth={1.6} />
              <span className="dz-title">Choose a CSV, Excel or PDF file</span>
              <span className="dz-sub">CSV &amp; Excel are read on your device. PDFs (and photos of statements) are read by Claude's API.</span>
              <input type="file" accept=".csv,.xls,.xlsx,.txt,.pdf,.png,.jpg,.jpeg,.webp" onChange={handleFile} hidden />
              <span className="dz-btn">Browse files</span>
            </label>
            <div className="imp-note">
              <Info size={14} /> Nothing is categorised on its own — you choose every category in the next step. Anything that looks already imported is detected and left unticked. For long PDF statements, a CSV/Excel export is more reliable.
            </div>
            <div className="imp-divider">or</div>
            <div className="sbi-block">
              <div className="sbi-title"><FileSpreadsheet size={15} /> SBI Password-Protected Statement</div>
              <div className="sbi-row" style={{ flexWrap: "wrap", gap: 8 }}>
                <select className="sbi-pwd" style={{ flex: "0 0 auto", width: "auto" }} value={sbiOwner} onChange={(e) => setSbiOwner(e.target.value)}>
                  <option value="sbi_srp">SBI SRP</option>
                  <option value="sbi_sid">SBI Sid</option>
                  <option value="sbi_mn">SBI MN</option>
                </select>
                <input
                  type="password"
                  className="sbi-pwd"
                  placeholder="Statement password"
                  value={sbiPwd}
                  onChange={(e) => setSbiPwd(e.target.value)}
                />
                <label className="sbi-upload-btn" style={!sbiPwd.trim() ? {opacity:.45,pointerEvents:"none"} : {}}>
                  Upload .xlsx
                  <input type="file" accept=".xlsx" onChange={handleSBIFile} hidden />
                </label>
              </div>
              <div className="imp-note"><Info size={14} /> Select whose account, then enter password. Each import marks that SBI account as done for the month.</div>
            </div>
            <div className="imp-divider">or</div>
            <div className="sbi-block">
              <div className="sbi-title"><FileSpreadsheet size={15} /> HDFC Credit Card Statement (PDF)</div>
              <div className="sbi-row" style={{ flexWrap: "wrap", gap: 8 }}>
                <select className="sbi-pwd" style={{ flex: "0 0 auto", width: "auto" }} value={ccCardType} onChange={(e) => setCcCardType(e.target.value)}>
                  <option value="hdfc_regalia">Regalia (SIDD0971)</option>
                  <option value="hdfc_solitaire">Solitaire (SARY5172)</option>
                </select>
                <input
                  type="password"
                  className="sbi-pwd"
                  placeholder="Statement password"
                  value={ccPwd}
                  onChange={(e) => setCcPwd(e.target.value)}
                />
                <label className="sbi-upload-btn" style={!ccPwd.trim() ? {opacity:.45,pointerEvents:"none"} : {}}>
                  Upload .pdf
                  <input type="file" accept=".pdf" onChange={handleCCFile} hidden />
                </label>
              </div>
              <div className="imp-note"><Info size={14} /> Select which card, then enter its password. Import once per card — each upload marks that card as done for the month.</div>
            </div>
            <div className="imp-divider">or</div>
            <div className="sbi-block">
              <div className="sbi-title"><FileSpreadsheet size={15} /> Bank of Maharashtra Statement (PDF)</div>
              <div className="sbi-row">
                <input
                  type="password"
                  className="sbi-pwd"
                  placeholder="Statement password"
                  value={bomPwd}
                  onChange={(e) => setBomPwd(e.target.value)}
                />
                <label className="sbi-upload-btn" style={!bomPwd.trim() ? {opacity:.45,pointerEvents:"none"} : {}}>
                  Upload .pdf
                  <input type="file" accept=".pdf,.PDF" onChange={handleBOMFile} hidden />
                </label>
              </div>
              <div className="imp-note"><Info size={14} /> Password is saved in your browser. Only debits are imported — credits and internal transfers are excluded.</div>
            </div>
            <div className="imp-divider">or</div>
            <div className="sbi-block">
              <div className="sbi-title"><FileSpreadsheet size={15} /> Union Bank of India Statement (Excel)</div>
              <div className="sbi-row">
                <span style={{flex:1, fontSize:12, color:"var(--faint)"}}>No password needed — download the .xlsx from UBI NetBanking and upload directly.</span>
                <label className="sbi-upload-btn">
                  Upload .xlsx
                  <input type="file" accept=".xlsx,.xls" onChange={handleUBIFile} hidden />
                </label>
              </div>
              <div className="imp-note"><Info size={14} /> Only withdrawals are imported. UBI statements include your own category labels — these appear as descriptions.</div>
            </div>
            <div className="imp-divider">or</div>
            <div className="sbi-block">
              <div className="sbi-title"><FileSpreadsheet size={15} /> HDFC Bank Account Statement (PDF)</div>
              <div className="sbi-row">
                <input
                  type="password"
                  className="sbi-pwd"
                  placeholder="Statement password"
                  value={hdfcBankPwd}
                  onChange={(e) => setHdfcBankPwd(e.target.value)}
                />
                <label className="sbi-upload-btn" style={!hdfcBankPwd.trim() ? {opacity:.45,pointerEvents:"none"} : {}}>
                  Upload .pdf
                  <input type="file" accept=".pdf" onChange={handleHDFCBankFile} hidden />
                </label>
              </div>
              <div className="imp-note"><Info size={14} /> Password is saved in your browser. Only debits are imported — salary credits and refunds are excluded. CC bill payments appear here AND in CC statements; skip the duplicates in the review step.</div>
            </div>
          </div>
        )}

        {step === "loading" && (
          <div className="imp-body">
            <div className="loadbox">
              <span className="spin" />
              <span className="dz-title">Reading {fileName}…</span>
              <span className="dz-sub">Extracting transactions from your statement. This can take a few moments.</span>
            </div>
          </div>
        )}

        {step === "map" && (
          <div className="imp-body">
            <p className="imp-sub">From <strong>{fileName}</strong> — confirm which column is which. I've guessed; fix anything that's off.</p>
            <div className="preview">
              <table><tbody>
                {rows.slice(0, 8).map((r, ri) => (
                  <tr key={ri} className={ri === headerRow ? "hr" : ""}>
                    <td className="rownum">{ri === headerRow ? "hdr" : (ri - headerRow > 0 ? ri - headerRow : "")}</td>
                    {r.slice(0, 7).map((c, ci) => (<td key={ci}>{String(c).slice(0, 18)}</td>))}
                  </tr>
                ))}
              </tbody></table>
            </div>
            <div className="map-grid">
              <Field label="Header row">
                <input type="number" min="1" value={headerRow + 1}
                  onChange={(e) => setHeaderRow(Math.max(0, (parseInt(e.target.value, 10) || 1) - 1))} />
              </Field>
              <Field label="Date column"><ColSelect value={map.date} opts={colOpts} onChange={(v) => setMap({ ...map, date: v })} /></Field>
              <Field label="Description column"><ColSelect value={map.desc} opts={colOpts} onChange={(v) => setMap({ ...map, desc: v })} /></Field>
              <Field label="Date format">
                <select value={dateFmt} onChange={(e) => setDateFmt(e.target.value)}>
                  <option value="DMY">Day · Month · Year (05/06/2026)</option>
                  <option value="MDY">Month · Day · Year</option>
                  <option value="YMD">Year · Month · Day</option>
                </select>
              </Field>
            </div>
            <div className="amount-mode">
              <label className="radio"><input type="radio" checked={amountMode === "split"} onChange={() => setAmountMode("split")} /> Separate debit &amp; credit columns</label>
              <label className="radio"><input type="radio" checked={amountMode === "single"} onChange={() => setAmountMode("single")} /> One amount column</label>
            </div>
            {amountMode === "split" ? (
              <div className="map-grid">
                <Field label="Debit / withdrawal (money out)"><ColSelect value={map.debit} opts={colOpts} onChange={(v) => setMap({ ...map, debit: v })} /></Field>
                <Field label="Credit / deposit (ignored)"><ColSelect value={map.credit} opts={colOpts} onChange={(v) => setMap({ ...map, credit: v })} allowNone /></Field>
              </div>
            ) : (
              <div className="map-grid">
                <Field label="Amount column"><ColSelect value={map.amount} opts={colOpts} onChange={(v) => setMap({ ...map, amount: v })} /></Field>
                <Field label="Expenses are the…">
                  <select value={singleSign} onChange={(e) => setSingleSign(e.target.value)}>
                    <option value="pos">Positive amounts</option>
                    <option value="neg">Negative amounts</option>
                  </select>
                </Field>
              </div>
            )}
            <div className="imp-actions">
              <button className="btn-ghost" onClick={() => setStep("upload")}>Back</button>
              <button className="btn-add" disabled={map.date < 0 || (amountMode === "split" ? map.debit < 0 : map.amount < 0)} onClick={buildTxns}>
                Find transactions <ArrowRight size={15} />
              </button>
            </div>
          </div>
        )}

        {step === "review" && (() => {
          const includedCount = txns.filter((t) => include[t.key]).length;
          const uncatCount = txns.filter((t) => include[t.key] && !assign[t.key]).length;
          const canImport = assignedCount > 0 && uncatCount === 0;
          return (
          <div className="imp-body">
            <div className="rev-summary">
              <strong>{txns.length}</strong> found · <strong>{includedCount}</strong> selected
              {uncatCount > 0
                ? <span className="rev-uncat"> · <strong>{uncatCount}</strong> still need a category ↓</span>
                : assignedCount > 0 ? <span style={{color:"var(--teal)"}}> · all categorised ✓</span> : null}
              {dupCount > 0 && <span className="rev-dupnote"> · {dupCount} look already imported (unticked)</span>}
            </div>
            {uncatCount > 0 && (
              <div className="imp-readnote" style={{background:"#FFFBF4",borderColor:"#F0DBB8",color:"var(--amber)"}}>
                <Info size={14} /> Pick a category for every ticked transaction before saving — uncategorised ones won't be imported.
              </div>
            )}
            {viaAPI && <div className="imp-readnote"><Info size={14} /> Read from your statement by Claude — please sanity-check amounts and dates before importing.</div>}
            <div className="rev-tools">
              <div className="rev-search"><Search size={14} /><input placeholder="Filter by description…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
              <label className="chk-inline"><input type="checkbox" checked={onlyUnassigned} onChange={(e) => setOnlyUnassigned(e.target.checked)} /> Uncategorised only</label>
            </div>
            <div className="bulk">
              <span>Set all shown to:</span>
              <CatSelect categories={categories} value={bulkCat} onChange={setBulkCat} />
              <button className="btn-ghost sm" disabled={!bulkCat} onClick={applyBulk}>Apply to {visible.length}</button>
            </div>
            <div className="rev-list">
              {visible.map((t) => {
                const needsCat = include[t.key] && !assign[t.key];
                return (
                  <div className={`rev-row ${!include[t.key] ? "off" : ""} ${needsCat ? "needs-cat" : ""}`} key={t.key}>
                    <input type="checkbox" checked={!!include[t.key]} onChange={(e) => setInclude({ ...include, [t.key]: e.target.checked })} />
                    <div className="rev-main">
                      <span className="rev-desc">{t.desc || "—"}{dup[t.key] && <span className="dupbadge">already imported?</span>}</span>
                      <span className="rev-meta num">{t.date || "no date"} · {money(t.amount, sym)}</span>
                    </div>
                    <CatSelect categories={categories} value={assign[t.key] || ""}
                      onChange={(v) => setAssign({ ...assign, [t.key]: v })}
                      hint={assign[t.key] && merchantMap[normMerchant(t.desc)] === assign[t.key] ? "remembered from last time" : needsCat ? "← pick a category" : ""} />
                    {assign[t.key] && (
                      <div className="person-row">
                        {["Sid","Manali","Saryu"].map(p => {
                          const sel = (personAssign[t.key]||"").split(",").filter(Boolean);
                          const on = sel.includes(p);
                          return <button key={p} type="button"
                            className={on ? "person-btn on" : "person-btn"}
                            onClick={() => {
                              const next = on ? sel.filter(x => x !== p) : [...sel, p];
                              setPersonAssign({ ...personAssign, [t.key]: next.join(",") });
                            }}>{p}</button>;
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
              {!visible.length && <div className="empty">No transactions match this filter.</div>}
            </div>
            <label className="remember"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Remember these merchant → category choices and pre-fill them next time</label>
            <div className="imp-actions">
              <button className="btn-ghost" onClick={() => setStep("map")}>Back</button>
              <button className="btn-add" disabled={!canImport} onClick={doImport}>
                <Check size={16} /> {canImport ? `Save ${assignedCount} expense${assignedCount === 1 ? "" : "s"}` : uncatCount > 0 ? `${uncatCount} still need a category` : "Select transactions above"}
              </button>
            </div>
          </div>
          );
        })()}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
function Styles() {
  return (<style>{`
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Space+Grotesk:wght@500;600;700&family=JetBrains+Mono:wght@500;600&display=swap');
.ledger-root{
  --bg:#ECEFEE; --surface:#FFFFFF; --ink:#171B1E; --muted:#6B757D; --faint:#9AA3AB;
  --hairline:#E4E8EA; --teal:#0E7C6B; --teal-soft:#E2F1ED; --amber:#B45309;
  --red:#C02942; --red-soft:#F7DEE3;
  background:var(--bg); color:var(--ink); font-family:'Inter',system-ui,sans-serif;
  min-height:100%; padding:22px; max-width:1100px; margin:0 auto; -webkit-font-smoothing:antialiased;
}
.ledger-root *{box-sizing:border-box;}
.num{font-family:'JetBrains Mono',ui-monospace,monospace; font-variant-numeric:tabular-nums; letter-spacing:-0.02em;}
.loading{padding:80px 0; text-align:center; color:var(--muted); font-size:15px;}
.fig-over{color:var(--red);}
.fig-good{color:var(--teal);}

.mast{display:flex; justify-content:space-between; align-items:flex-end; gap:16px; flex-wrap:wrap; margin-bottom:18px;}
.mast-title{display:flex; align-items:center; gap:12px;}
.mast-mark{width:38px; height:38px; border-radius:11px; background:var(--ink); color:#fff; display:grid; place-items:center; flex-shrink:0;}
.mast h1{font-family:'Space Grotesk',sans-serif; font-size:25px; font-weight:700; margin:0; letter-spacing:-0.02em;}
.mast p{margin:1px 0 0; font-size:12.5px; color:var(--muted);}
.mast-controls{display:flex; align-items:center; gap:10px;}
.monthnav{display:flex; align-items:center; background:var(--surface); border:1px solid var(--hairline); border-radius:11px; padding:3px;}
.monthnav button{border:0; background:transparent; padding:6px; border-radius:8px; cursor:pointer; color:var(--ink); display:grid; place-items:center;}
.monthnav button:hover{background:var(--bg);}
.monthnav-label{font-family:'Space Grotesk',sans-serif; font-weight:600; font-size:13.5px; padding:0 10px; min-width:118px; text-align:center;}
.btn-ghost{display:inline-flex; align-items:center; gap:7px; background:var(--surface); border:1px solid var(--hairline); border-radius:11px; padding:9px 13px; font-size:13px; font-weight:500; cursor:pointer; color:var(--ink); font-family:inherit;}
.btn-ghost:hover{border-color:var(--ink);}
.btn-ghost.full{width:100%; justify-content:center; margin-top:4px;}

.strip{display:grid; grid-template-columns:repeat(4,1fr); gap:1px; background:var(--hairline); border:1px solid var(--hairline); border-radius:14px; overflow:hidden; margin-bottom:12px;}
.stat{background:var(--surface); padding:14px 16px; display:flex; flex-direction:column; gap:4px;}
.stat-label{font-size:11.5px; color:var(--muted); font-weight:500;}
.stat-value{font-size:20px; font-weight:600;}
.stat-sub{font-size:11px; color:var(--faint); font-family:'JetBrains Mono',monospace;}

.usebar-wrap{display:flex; align-items:center; gap:12px; margin-bottom:14px; padding:0 2px;}
.usebar-label{font-size:11.5px; color:var(--muted); white-space:nowrap;}
.usebar{position:relative; flex:1; height:8px; background:var(--surface); border:1px solid var(--hairline); border-radius:6px; overflow:hidden;}
.usebar-fill{position:absolute; inset:0 auto 0 0; border-radius:6px; transition:width .5s ease;}
.usebar-over{font-size:11px; color:var(--red); font-weight:600;}

.alert{display:flex; align-items:center; gap:10px; background:var(--red-soft); color:var(--red); border-radius:12px; padding:12px 15px; font-size:13.5px; margin-bottom:16px;}
.alert strong{font-weight:600;}

.grid{display:grid; grid-template-columns:1.7fr 1fr; gap:14px; align-items:start;}
.panel{background:var(--surface); border:1px solid var(--hairline); border-radius:14px; padding:16px 18px;}
.panel-head{display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; gap:10px;}
.panel-head h2{font-family:'Space Grotesk',sans-serif; font-size:15px; font-weight:600; margin:0; letter-spacing:-0.01em;}
.toggle{display:inline-flex; align-items:center; gap:5px; border:1px solid var(--hairline); background:var(--bg); border-radius:8px; padding:5px 9px; font-size:11.5px; color:var(--muted); cursor:pointer; font-family:inherit;}
.toggle:hover{border-color:var(--ink); color:var(--ink);}

.sec{margin-bottom:18px;}
.sec:last-child{margin-bottom:0;}
.sec-head{display:flex; justify-content:space-between; align-items:baseline; padding-bottom:8px; margin-bottom:12px; border-bottom:1px solid var(--hairline);}
.sec-name{font-size:13px; font-weight:600; text-transform:uppercase; letter-spacing:.06em; color:var(--muted);}
.sec-sub{font-size:12px; font-weight:600;}
.rows{display:flex; flex-direction:column; gap:14px;}
.row-top{display:flex; justify-content:space-between; align-items:baseline; margin-bottom:7px;}
.row-name{font-size:13.5px; font-weight:500;}
.row-fig{font-size:12.5px; font-weight:600;}
.row-of{color:var(--faint); font-weight:500;}
.track{position:relative; height:13px; background:var(--bg); border-radius:7px; overflow:hidden;}
.seg{position:absolute; top:0; bottom:0; border-radius:7px; transition:width .5s ease;}
.seg.under{left:0;}
.seg.over{background:var(--red); border-radius:0 7px 7px 0;}
.track-marker{position:absolute; top:-2px; bottom:-2px; width:2px; background:var(--ink); opacity:.55; z-index:2;}
.row-foot{margin-top:6px;}
.tag{font-size:11px; font-weight:600; padding:2px 8px; border-radius:6px; font-family:'JetBrains Mono',monospace;}
.tag-red{background:var(--red-soft); color:var(--red);}
.tag-amber{background:#FBEEDC; color:var(--amber);}
.tag-teal{background:var(--teal-soft); color:var(--teal);}
.tag-faint{background:var(--bg); color:var(--faint);}

.side{display:flex; flex-direction:column; gap:14px;}
.cf{display:flex; flex-direction:column; gap:2px;}
.cf-line{display:flex; justify-content:space-between; align-items:center; font-size:13px; padding:6px 0;}
.cf-line>span:first-child{color:var(--muted);}
.cf-line .num{font-weight:600; font-size:13px;}
.cf-total{border-top:1px solid var(--hairline); padding-top:9px; margin-top:3px;}
.cf-total>span:first-child{color:var(--ink); font-weight:500;}
.cf-net{border-top:1px solid var(--hairline); padding-top:9px; margin-top:3px;}
.cf-net>span:first-child{color:var(--ink); font-weight:600;}
.cf-net .num{font-size:15px;}
.cf-rate>span:first-child{color:var(--muted);}
.cf-note{font-size:11px; color:var(--faint); margin:8px 0 0; line-height:1.45;}
.chart{margin:0 -6px;}
.chart-note{font-size:11.5px; color:var(--muted); margin:6px 2px 0; line-height:1.45;}
.overlist{list-style:none; margin:0; padding:0; display:flex; flex-direction:column;}
.overlist li{display:flex; justify-content:space-between; align-items:center; padding:9px 0; font-size:13px; border-bottom:1px solid var(--hairline);}
.overlist li:last-child{border-bottom:0;}
.overlist .fig-over{display:inline-flex; align-items:center; gap:2px; font-weight:600; font-size:12.5px;}

.logbar{margin-bottom:14px;}
.logform{display:grid; grid-template-columns:1.1fr .85fr .85fr .95fr 1.3fr auto; gap:9px;}
.logform select,.logform input[type=date],.logform input[type=text]{background:var(--surface); border:1px solid var(--hairline); border-radius:10px; padding:10px 12px; font-size:13px; font-family:inherit; color:var(--ink); width:100%;}
.amt-input{display:flex; align-items:center; background:var(--surface); border:1px solid var(--hairline); border-radius:10px; padding:0 12px;}
.amt-input span{color:var(--muted); font-size:13px; font-family:'JetBrains Mono',monospace;}
.amt-input input{border:0; background:transparent; padding:10px 6px; width:100%; font-size:13px; font-family:'JetBrains Mono',monospace; color:var(--ink);}
.amt-input.sm{padding:0 9px;} .amt-input.sm input{padding:8px 5px;}
.logform input:focus,.logform select:focus,.amt-input:focus-within,.cat-edit input:focus{outline:2px solid var(--teal); outline-offset:1px; border-color:transparent;}
.btn-add{display:inline-flex; align-items:center; gap:6px; justify-content:center; background:var(--ink); color:#fff; border:0; border-radius:10px; padding:10px 16px; font-size:13px; font-weight:600; cursor:pointer; font-family:inherit;}
.btn-add:hover{background:#000;}
.btn-add.full{width:100%; margin-top:12px; padding:12px;}
.btn-sample{display:inline-flex; align-items:center; gap:6px; background:var(--teal-soft); color:var(--teal); border:0; border-radius:9px; padding:7px 12px; font-size:12.5px; font-weight:600; cursor:pointer; font-family:inherit;}
.btn-ghost-active{background:var(--ink); color:#fff; border-color:var(--ink);}
.btn-ghost-active:hover{background:#000; border-color:#000;}
.btn-add.flash{background:var(--teal);}
.person-row{grid-column:1 / -1; display:flex; align-items:center; gap:7px; padding:2px 0;}
.person-label{font-size:12px; color:var(--muted); font-weight:500; flex-shrink:0;}
.person-btn{border:1px solid var(--hairline); background:var(--bg); border-radius:20px; padding:4px 13px; font-size:12px; font-weight:500; cursor:pointer; font-family:inherit; color:var(--muted); transition:all .12s;}
.person-btn:hover{border-color:var(--ink); color:var(--ink);}
.person-btn.on{background:var(--ink); color:#fff; border-color:var(--ink);}
.split-hint{font-size:11.5px; color:var(--teal); font-weight:500; margin-left:4px;}
.person-tag{display:inline-block; background:var(--teal-soft); color:var(--teal); font-size:10px; font-weight:600; padding:1px 6px; border-radius:5px; margin-left:5px; font-family:'JetBrains Mono',monospace;}
.analysis-wrap{display:flex; flex-direction:column; gap:14px;}
.analysis-panel{padding:14px 18px 6px;}
.analysis-sec-head{display:flex; justify-content:space-between; align-items:baseline; padding-bottom:8px; margin-bottom:4px; border-bottom:1px solid var(--hairline);}

/* statement status */
.stmt-panel{margin-bottom:14px; padding:12px 16px;}
.stmt-done{border-color:var(--teal);}
.stmt-head{display:flex; align-items:center; gap:8px; font-size:13px; margin-bottom:10px;}
.stmt-head strong{font-weight:600;}
.stmt-icon-warn{color:var(--amber); flex-shrink:0;}
.stmt-icon-ok{color:var(--teal); flex-shrink:0;}
.stmt-list{display:flex; flex-wrap:wrap; gap:7px;}
.stmt-item{display:inline-flex; align-items:center; gap:6px; border:1px solid var(--hairline); background:var(--bg); border-radius:20px; padding:5px 12px; font-size:12px; font-weight:500; cursor:pointer; font-family:inherit; color:var(--muted); transition:all .12s;}
.stmt-item:hover{border-color:var(--ink); color:var(--ink);}
.stmt-item.done{background:var(--teal-soft); color:var(--teal); border-color:var(--teal);}
.stmt-check{width:14px; height:14px; border:1.5px solid var(--hairline); border-radius:3px; display:grid; place-items:center; flex-shrink:0;}
.stmt-item.done .stmt-check{background:var(--teal); border-color:var(--teal); color:#fff;}

.entries{list-style:none; margin:0; padding:0; display:flex; flex-direction:column;}
.entries li{display:grid; grid-template-columns:82px 1.05fr 120px 1.35fr auto 30px 30px; align-items:center; gap:12px; padding:11px 0; border-bottom:1px solid var(--hairline); font-size:13px;}
.entries li:last-child{border-bottom:0;}
.en-date{font-size:12px; color:var(--muted);}
.en-cat{font-weight:500;}
.en-note{color:var(--muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
.en-amt{text-align:right; font-weight:600;}
.en-del{border:0; background:transparent; color:var(--faint); cursor:pointer; display:grid; place-items:center; padding:5px; border-radius:7px;}
.en-del:hover{color:var(--red); background:var(--red-soft);}
.entries li.en-edit{display:grid; grid-template-columns:1.3fr .7fr .8fr .9fr 1fr auto; gap:8px; padding:10px 0; background:var(--bg); border-radius:10px; padding:10px 12px; margin:2px -12px;}
.en-edit-bank{border:1px solid var(--hairline); border-radius:9px; padding:8px 10px; font-size:12.5px; font-family:inherit; background:var(--surface); color:var(--ink);}
.en-edit-cat{border:1px solid var(--hairline); border-radius:9px; padding:8px 10px; font-size:12.5px; font-family:inherit; background:var(--surface); color:var(--ink);}
.en-edit-amt{background:var(--surface);}
.en-edit-date{border:1px solid var(--hairline); border-radius:9px; padding:8px 10px; font-size:12.5px; font-family:inherit; background:var(--surface); color:var(--ink);}
.en-edit-note{border:1px solid var(--hairline); border-radius:9px; padding:8px 10px; font-size:12.5px; font-family:inherit; background:var(--surface); color:var(--ink);}
.en-edit-btns{display:flex; gap:5px; justify-content:flex-end;}

.empty{padding:24px 4px; text-align:center; color:var(--muted); font-size:13.5px;}
.foot{text-align:center; color:var(--faint); font-size:11.5px; margin-top:18px;}

.scrim{position:fixed; inset:0; background:rgba(20,24,28,.42); display:flex; justify-content:flex-end; z-index:50; backdrop-filter:blur(2px);}
.drawer{width:min(440px,100%); height:100%; background:var(--bg); padding:22px; overflow-y:auto; box-shadow:-12px 0 40px rgba(0,0,0,.18);}
.drawer-head{display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;}
.drawer-head h2{font-family:'Space Grotesk',sans-serif; font-size:18px; font-weight:600; margin:0;}
.drawer-hint{font-size:12px; color:var(--muted); margin:0 0 16px; line-height:1.5;}
.icon-btn{border:0; background:var(--surface); border:1px solid var(--hairline); border-radius:9px; padding:7px; cursor:pointer; color:var(--ink); display:grid; place-items:center;}
.icon-btn.danger:hover{color:var(--red); border-color:var(--red);}
.icon-btn:hover{border-color:var(--ink);}
.cur-row{display:flex; justify-content:space-between; align-items:center; background:var(--surface); border:1px solid var(--hairline); border-radius:12px; padding:12px 14px; margin-bottom:14px; font-size:13px; font-weight:500;}
.cur-pills{display:flex; gap:5px; flex-wrap:wrap;}
.cur{border:1px solid var(--hairline); background:var(--bg); border-radius:8px; padding:5px 9px; font-size:13px; cursor:pointer; font-family:'JetBrains Mono',monospace; min-width:30px; color:var(--ink);}
.cur.on{background:var(--ink); color:#fff; border-color:var(--ink);}
.cat-list{background:var(--surface); border:1px solid var(--hairline); border-radius:12px; padding:6px 14px; margin-bottom:12px;}
.income-block{border-color:var(--teal); }
.cat-head{display:grid; grid-template-columns:1fr 130px 34px; gap:10px; padding:8px 0 6px; font-size:11px; color:var(--faint); text-transform:uppercase; letter-spacing:.04em;}
.cat-edit{display:grid; grid-template-columns:1fr 130px 34px; gap:10px; align-items:center; padding:7px 0; border-top:1px solid var(--hairline);}
.cat-edit>input{border:1px solid var(--hairline); border-radius:9px; padding:8px 10px; font-size:13px; font-family:inherit; background:var(--bg); color:var(--ink); min-width:0;}
.cat-edit>input[readonly]{color:var(--muted);}
.drawer-total{display:flex; justify-content:space-between; align-items:center; padding:16px 4px 4px; font-size:13.5px; color:var(--muted);}
.drawer-total strong{font-size:18px; color:var(--ink); font-weight:600;}

/* ---- import wizard ---- */
.imp{width:min(720px,100%); height:100%; background:var(--bg); padding:22px; overflow-y:auto; box-shadow:-12px 0 40px rgba(0,0,0,.18);}
.imp-head{display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;}
.imp-head h2{font-family:'Space Grotesk',sans-serif; font-size:18px; font-weight:600; margin:0;}
.imp-steps{display:flex; align-items:center; gap:8px; font-size:11.5px; color:var(--faint); margin-bottom:16px;}
.imp-steps span{font-weight:500;}
.imp-steps span.on{color:var(--ink); font-weight:600;}
.imp-body{display:flex; flex-direction:column; gap:14px;}
.imp-err{display:flex; align-items:center; gap:8px; background:var(--red-soft); color:var(--red); border-radius:10px; padding:10px 13px; font-size:12.5px;}
.imp-note,.imp-readnote{display:flex; align-items:flex-start; gap:8px; background:var(--surface); border:1px solid var(--hairline); border-radius:11px; padding:11px 13px; font-size:12.5px; color:var(--muted); line-height:1.5;}
.imp-readnote{background:#FBEEDC; border-color:#F0DBB8; color:var(--amber);}
.imp-sub{font-size:12.5px; color:var(--muted); margin:0;}
.dropzone{display:flex; flex-direction:column; align-items:center; gap:8px; text-align:center; border:1.5px dashed var(--hairline); border-radius:14px; padding:30px 20px; cursor:pointer; background:var(--surface); color:var(--ink);}
.dropzone:hover{border-color:var(--teal);}
.dz-title{font-weight:600; font-size:14px;}
.dz-sub{font-size:12px; color:var(--muted); max-width:380px; line-height:1.45;}
.dz-btn{margin-top:4px; background:var(--ink); color:#fff; border-radius:9px; padding:8px 16px; font-size:12.5px; font-weight:600;}
.loadbox{display:flex; flex-direction:column; align-items:center; gap:10px; text-align:center; padding:40px 20px;}
.spin{width:26px; height:26px; border-radius:50%; border:3px solid var(--hairline); border-top-color:var(--teal); animation:ledspin .8s linear infinite;}
@keyframes ledspin{to{transform:rotate(360deg);}}
.preview{overflow-x:auto; border:1px solid var(--hairline); border-radius:10px; background:var(--surface);}
.preview table{border-collapse:collapse; width:100%; font-size:11px;}
.preview td{border:1px solid var(--hairline); padding:4px 7px; white-space:nowrap; font-family:'JetBrains Mono',monospace; color:var(--ink);}
.preview tr.hr td{background:var(--teal-soft); font-weight:600;}
.preview .rownum{color:var(--faint); background:var(--bg);}
.map-grid{display:grid; grid-template-columns:1fr 1fr; gap:10px;}
.imp-field{display:flex; flex-direction:column; gap:4px; font-size:11.5px; color:var(--muted);}
.imp-field select,.imp-field input{border:1px solid var(--hairline); border-radius:9px; padding:8px 10px; font-size:13px; font-family:inherit; background:var(--surface); color:var(--ink); width:100%;}
.amount-mode{display:flex; gap:18px; flex-wrap:wrap;}
.radio,.chk-inline{display:inline-flex; align-items:center; gap:7px; font-size:12.5px; color:var(--ink); cursor:pointer;}
.imp-actions{display:flex; justify-content:space-between; gap:10px; padding-top:6px;}
.imp-actions .btn-add[disabled]{opacity:.45; cursor:not-allowed;}
.imp-divider{display:flex; align-items:center; gap:10px; color:var(--faint); font-size:11px; font-weight:500; text-transform:uppercase; letter-spacing:.06em;}
.imp-divider::before,.imp-divider::after{content:""; flex:1; height:1px; background:var(--hairline);}
.sbi-block{border:1.5px dashed var(--hairline); border-radius:14px; padding:16px 18px; background:var(--surface); display:flex; flex-direction:column; gap:10px;}
.sbi-title{font-size:13px; font-weight:600; display:flex; align-items:center; gap:7px; color:var(--ink);}
.sbi-row{display:flex; gap:8px; align-items:center;}
.sbi-pwd{flex:1; border:1px solid var(--hairline); border-radius:9px; padding:9px 11px; font-size:13px; font-family:inherit; background:var(--bg); color:var(--ink); outline:none;}
.sbi-pwd:focus{border-color:var(--teal);}
.sbi-upload-btn{display:inline-flex; align-items:center; gap:6px; background:var(--ink); color:#fff; border-radius:9px; padding:9px 14px; font-size:12.5px; font-weight:600; cursor:pointer; white-space:nowrap; transition:opacity .15s;}
.rev-summary{font-size:13px; color:var(--muted);}
.rev-summary strong{color:var(--ink);}
.rev-dupnote{color:var(--amber);}
.rev-tools{display:flex; align-items:center; gap:12px; flex-wrap:wrap;}
.rev-search{display:flex; align-items:center; gap:7px; flex:1; min-width:160px; background:var(--surface); border:1px solid var(--hairline); border-radius:10px; padding:0 10px; color:var(--muted);}
.rev-search input{border:0; background:transparent; padding:9px 4px; width:100%; font-size:13px; font-family:inherit; color:var(--ink);}
.bulk{display:flex; align-items:center; gap:9px; flex-wrap:wrap; font-size:12.5px; color:var(--muted); background:var(--surface); border:1px solid var(--hairline); border-radius:11px; padding:10px 12px;}
.btn-ghost.sm{padding:7px 11px; font-size:12px;}
.rev-list{display:flex; flex-direction:column; max-height:46vh; overflow-y:auto; border:1px solid var(--hairline); border-radius:12px; background:var(--surface);}
.rev-row{display:grid; grid-template-columns:auto 1fr minmax(170px,200px); gap:11px; align-items:center; padding:10px 13px; border-bottom:1px solid var(--hairline);}
.rev-row:last-child{border-bottom:0;}
.rev-row.off{opacity:.45;}
.rev-main{display:flex; flex-direction:column; gap:2px; min-width:0;}
.rev-desc{font-size:13px; font-weight:500; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; display:flex; align-items:center; gap:7px;}
.rev-meta{font-size:11.5px; color:var(--muted);}
.dupbadge{background:#FBEEDC; color:var(--amber); font-size:10px; font-weight:600; padding:1px 6px; border-radius:5px; white-space:nowrap; font-family:'JetBrains Mono',monospace;}
.catsel{display:flex; flex-direction:column; gap:2px;}
.catsel select{border:1px solid var(--hairline); border-radius:9px; padding:8px 9px; font-size:12.5px; font-family:inherit; background:var(--surface); color:var(--ink); width:100%;}
.catsel select.needpick{border-color:var(--amber); background:#FFFBF4;}
.catsel-hint{font-size:10px; color:var(--teal);}
.rev-row.needs-cat{background:#FFFBF4; border-left:3px solid var(--amber); padding-left:10px;}
.rev-uncat{color:var(--amber); font-weight:600;}
.remember{display:flex; align-items:center; gap:8px; font-size:12px; color:var(--muted); cursor:pointer;}

@media (max-width:820px){
  .ledger-root{padding:16px;}
  .strip{grid-template-columns:1fr 1fr;}
  .grid{grid-template-columns:1fr;}
  .logform{grid-template-columns:1fr 1fr;}
  .logform .btn-add{grid-column:1 / -1;}
  .entries li{grid-template-columns:60px 1fr 92px auto 28px 28px;}
  .entries li.en-edit{grid-template-columns:1fr 1fr; row-gap:6px;}
  .en-edit-btns{grid-column:1/-1; justify-content:flex-start;}
  .en-note{display:none;}
  .map-grid{grid-template-columns:1fr;}
  .rev-row{grid-template-columns:auto 1fr; row-gap:8px;}
  .rev-row .catsel{grid-column:1 / -1; padding-left:26px;}
}
@media (prefers-reduced-motion:reduce){ .seg,.usebar-fill{transition:none;} }
.en-bank{font-size:11px;color:var(--muted);font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;background:var(--surface);border:1px solid var(--hairline);border-radius:6px;padding:3px 8px;justify-self:start;max-width:100%;}
.entry-search{display:flex;align-items:center;gap:8px;margin:2px 0 12px;background:var(--surface);border:1px solid var(--hairline);border-radius:10px;padding:0 11px;color:var(--muted);}
.entry-search input{border:0;background:transparent;padding:10px 4px;width:100%;font-size:13px;font-family:inherit;color:var(--ink);outline:none;}
.entry-search .icon-btn{flex:0 0 auto;}
.person-row{display:flex;gap:4px;align-items:center;flex-wrap:wrap;margin-top:4px;}
.person-btn{border:1px solid var(--border);border-radius:12px;padding:2px 8px;font-size:11px;cursor:pointer;background:transparent;color:var(--ink);line-height:1.6;}
.person-btn.on{background:var(--teal);color:#fff;border-color:var(--teal);}
`}</style>);
}
