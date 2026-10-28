import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  ChevronLeft, ChevronRight, Plus, Trash2, SlidersHorizontal, X,
  TriangleAlert, Check, Wallet, ArrowUpRight, Sparkles, Eye, EyeOff,
  Upload, FileSpreadsheet, ArrowRight, Search, Info, BarChart2, Pencil, Download, LogOut, Scissors, Tag
} from "lucide-react";
import {
  ComposedChart, BarChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, Legend
} from "recharts";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { merchantKey } from "./api/_lib/categorize.js";
import { periodOf, currentPeriod, setMonthStart, getMonthStart, periodLabel } from "./src/period.js";
import {
  useMonthFigures, KpiStrip, PaceCard, BillsCard, BudgetsCard, StructureCard,
  CashFlowCard, PayeesCard, SetAsideCard, QuickAdd, HistoryView, dashCss,
} from "./src/dashboard.jsx";
import {
  classifyCredit, creditDupKey, MoneyInReview, IncomeView, incomeCss, monthIncome, dueDayOf, isBillCat, applyDueSheet, dueSheetRows, dueMonthsLabel, FREQS, FREQ_LABEL, CREDIT_KINDS, ordinal, guessRefundCat,
} from "./src/income.jsx";
import {
  DrillDown, computeAlerts, AlertsStrip, BalancesCard, GoalsCard, TagsView, SplitModal, CalendarView, AskView, featuresCss, parseTags,
} from "./src/features.jsx";

export const APP_VERSION = "2.3.0";

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
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

const FY_START = "2026-04", FY_END = "2027-03";

/* map planner order [Apr..Mar] -> calendar index [Jan..Dec] */
const P2C = [9, 10, 11, 0, 1, 2, 3, 4, 5, 6, 7, 8];
const cal = (p) => P2C.map((i) => p[i]);
const flat = (n) => Array(12).fill(n);
const at = (i, v) => { const a = Array(12).fill(0); a[i] = v; return a; };
const isFlat = (a) => a.every((x) => x === a[0]);

const SECTIONS = [
  "Household Fixed", "Utilities", "Personal", "Lifestyle",
  "Shopping", "Annual", "Insurance", "LIC Policies", "Claims & Transfers",
];
/* Money that moves but isn't household spend: office claims (reimbursed later)
 * and transfers between our own accounts. Filed and visible like any category,
 * but left out of Spent, budget use, savings and the over-budget alerts. */
const NONSPEND_SECTION = "Claims & Transfers";
const NONSPEND_SEED = ["Claim", "Internal TRF", "Investments", "GST (business)", "Reimbursement – Manali"];
/* Spend categories added after the ledger was first seeded: [name, section]. */
const SPEND_ADDITIONS = [["Bank charges", "Personal"]];
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
  // Claims & Transfers — tracked, never counted as spend
  ["Claim", NONSPEND_SECTION, true, flat(0)],
  ["Internal TRF", NONSPEND_SECTION, true, flat(0)],
];
const buildCats = () =>
  SEED.map(([name, section, recurring, p]) => ({ id: uid(), name, section, recurring, monthly: cal(p) }));
const buildIncome = () => [
  { id: uid(), name: "Salary", monthly: flat(400000) },
  { id: uid(), name: "Rent Income", monthly: flat(29000) },
];

/* -------------------------------------------------------------------------
 * Cloud-backed store.
 * Data lives in a single JSON blob on the server (/api/data, Vercel Blob) so it
 * persists across devices, browsers, and deployments. It is held in memory
 * only while the app is unlocked — nothing from the ledger is cached in this
 * browser any more, so a device that hasn't entered the passcode this visit
 * has nothing to show. Bank-statement passwords (ledger:*Pwd) are the one
 * exception: they stay in this browser only and are never synced.
 * ---------------------------------------------------------------------- */
const SENSITIVE = /Pwd$/; // password keys never leave the device

/* Older versions cached the whole ledger (and the passcode) in localStorage.
 * Clear that out on first load so it doesn't linger on shared devices. */
const KEEP_LOCAL = /Pwd$|^ledger:(lastBank|catPersonMap)$/;
function purgeLocalCache() {
  try {
    const drop = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("ledger:") && (!KEEP_LOCAL.test(k) || k === "ledger:passPwd")) drop.push(k);
    }
    drop.forEach((k) => localStorage.removeItem(k));
    sessionStorage.removeItem("ledger:gate");
  } catch {}
}
purgeLocalCache();

/* The ledger passcode. Held in memory only — never written to localStorage,
 * sessionStorage or a cookie — so every new visit, tab or reload asks for it
 * again, and logging out (or closing the tab) leaves nothing behind that opens
 * the ledger. Sent as a header on every API call. */
export const auth = {
  pass: "",
  needed: false,
  set(p) { this.pass = p || ""; },
  headers(extra) {
    const h = { ...(extra || {}) };
    if (this.pass) h["x-ledger-pass"] = this.pass;
    return h;
  },
};

/** fetch wrapper that attaches the passcode and flags a 401 back to the app. */
export async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: auth.headers({ ...(opts.headers || {}), ...(opts.body ? { "Content-Type": "application/json" } : {}) }),
  });
  let json = null;
  try { json = await res.json(); } catch {}
  if (res.status === 401 || (json && json.needsPasscode)) {
    auth.needed = true;
    window.dispatchEvent(new CustomEvent("ledger:needs-passcode"));
    throw new Error(json?.error || "Passcode required.");
  }
  if (!res.ok || (json && json.ok === false)) {
    throw new Error((json && json.error) || `Request failed (${res.status})`);
  }
  return json;
}

export const store = {
  cache: null,
  ready: false,
  _timer: null,
  _pending: null,
  protectedRemote: null, // null = unknown, false = API is open to anyone
  syncState: "idle",     // idle | saving | error
  loaded: false,         // true only when the server's copy was actually read
  async init() {
    if (this.ready) return;
    this.cache = {};
    this.loaded = false;
    try {
      const res = await fetch("/api/data", { cache: "no-store", headers: auth.headers() });
      if (res.status === 401) {
        auth.needed = true;
        this.ready = true;
        window.dispatchEvent(new CustomEvent("ledger:needs-passcode"));
        return;
      }
      if (res.ok) {
        const json = await res.json();
        this.protectedRemote = !!(json && json.protected);
        const remote = json && json.data;
        if (remote && typeof remote === "object") { this.cache = { ...remote }; this.loaded = true; }
      }
    } catch {}
    this.ready = true;
  },
  async get(k) {
    if (SENSITIVE.test(k)) { try { const r = localStorage.getItem(k); return r ? JSON.parse(r) : null; } catch { return null; } }
    return this.cache && k in this.cache ? this.cache[k] : null;
  },
  async set(k, v) {
    if (SENSITIVE.test(k)) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} return; }
    if (!this.cache) this.cache = {};
    this.cache[k] = v;
    this._scheduleSync();
  },
  _scheduleSync() {
    if (this._timer) clearTimeout(this._timer);
    this._timer = setTimeout(() => { this._timer = null; this._sync(); }, 800);
  },
  _setState(s) { this.syncState = s; window.dispatchEvent(new CustomEvent("ledger:sync", { detail: s })); },
  async _sync() {
    const payload = {};
    for (const k in this.cache) if (!SENSITIVE.test(k)) payload[k] = this.cache[k];
    // never push an empty ledger over a populated one
    if (!Object.keys(payload).length) return;
    this._setState("saving");
    const run = (async () => {
      try {
        const res = await fetch("/api/data", {
          method: "POST",
          headers: auth.headers({ "Content-Type": "application/json" }),
          body: JSON.stringify({ data: payload }),
        });
        if (res.status === 401) { window.dispatchEvent(new CustomEvent("ledger:needs-passcode")); this._setState("error"); return; }
        this._setState(res.ok ? "idle" : "error");
      } catch { this._setState("error"); }
    })();
    this._pending = run;
    await run;
  },
  /** Push any change still waiting for its debounce, then wait for it. */
  async flush() {
    if (this._timer) { clearTimeout(this._timer); this._timer = null; await this._sync(); }
    else if (this._pending) await this._pending;
  },
  /** Forget everything held in memory (used on logout and after a restore). */
  reset() {
    if (this._timer) clearTimeout(this._timer);
    this._timer = null; this._pending = null; this.cache = null; this.ready = false;
  },
};

/** Log out: save anything pending, then drop the passcode and the in-memory ledger. */
export async function logout() {
  try { await store.flush(); } catch {}
  store.reset();
  auth.set("");
  window.dispatchEvent(new CustomEvent("ledger:logout"));
}
const K_CATS = "ledger:categories", K_EXP = "ledger:expenses", K_SET = "ledger:settings", K_INC = "ledger:income";
const K_MAP = "ledger:merchantMap", K_STMTS = "ledger:stmts", K_AUDIT = "ledger:audit";
const K_CREDITS = "ledger:credits", K_CMAP = "ledger:creditMap", K_GOALS = "ledger:goals", K_BAL = "ledger:balances";

/* Transactions the categoriser would not guess at are parked under this id.
 * It deliberately isn't a real category, so the dashboard already rolls it into
 * "Uncategorised spend" — the money counts against the month from the moment it
 * is imported, it just isn't attributed yet. Nothing is ever silently dropped. */
const SUSPENSE_ID = "__suspense__";
const CAT_VERSION = 6;

const BANKS = [
  { key: "hdfc_regalia",  label: "HDFC Regalia CC",       auto: false, mode: "card" },
  { key: "hdfc_solitaire",label: "HDFC MoneyBack CC",      auto: false, mode: "card" }, // key kept from when it was labelled Solitaire
  { key: "bom",           label: "Bank of Maharashtra",    auto: true,  mode: "savings" },
  { key: "ubi",           label: "Union Bank of India",    auto: true,  mode: "savings" },
  { key: "hdfc_bank",     label: "HDFC Bank (Savings)",    auto: true,  mode: "savings" },
  { key: "sbi_srp",       label: "SBI SRP",                auto: false, mode: "savings" },
  { key: "sbi_sid",       label: "SBI Sid",                auto: false, mode: "savings" },
  { key: "sbi_mn",        label: "SBI MN",                 auto: false, mode: "savings" },
  // Cash has no statement — logged by hand, never in the monthly checklist
  { key: "cash",          label: "Cash",                   auto: false, mode: "cash", noStmt: true },
];
const PAY_MODES = [
  { key: "savings", label: "Savings account" },
  { key: "card",    label: "Credit card" },
  { key: "cash",    label: "Cash" },
];
const STMT_BANKS = BANKS.filter((b) => !b.noStmt);
/** <option>s for an account picker, grouped by payment mode. */
function BankOptions({ list = BANKS }) {
  return PAY_MODES.map((m) => {
    const opts = list.filter((b) => b.mode === m.key);
    if (!opts.length) return null;
    return (<optgroup key={m.key} label={m.label}>{opts.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}</optgroup>);
  });
}
const payModeOf = (bankKey) => BANKS.find((b) => b.key === bankKey)?.mode || "";

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
  const [loadFailed, setLoadFailed] = useState(false);
  const [categories, setCategories] = useState([]);
  const [income, setIncome] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [sym, setSym] = useState("₹");
  const [selMonth, setSelMonth] = useState(currentPeriod());
  const [manageOpen, setManageOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [stmtOpen, setStmtOpen] = useState(false);
  const [merchantMap, setMerchantMap] = useState({});
  const [stmts, setStmts] = useState({});
  const [auditLog, setAuditLog] = useState([]);
  const [credits, setCredits] = useState([]);
  const [creditMap, setCreditMap] = useState({});
  const [cardDue, setCardDue] = useState({});
  const [goals, setGoals] = useState([]);
  const [balances, setBalances] = useState({});
  const [monthStart, setMonthStartState] = useState(1);
  const [drill, setDrill] = useState(null);
  const [splitting, setSplitting] = useState(null);
  const [tagAll, setTagAll] = useState("");
  const [apiOpen, setApiOpen] = useState(false); // API reachable without a passcode
  const [sync, setSync] = useState("idle");

  const [lastBank, setLastBank] = useState(() => { try { return localStorage.getItem("ledger:lastBank") || ""; } catch { return ""; } });
  const [catPersonMap, setCatPersonMap] = useState(() => { try { return JSON.parse(localStorage.getItem("ledger:catPersonMap") || "{}"); } catch { return {}; } });
  const [reportFlash, setReportFlash] = useState(false);
  const [backupFlash, setBackupFlash] = useState(false);
  const [view, setView] = useState("dashboard");
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [entrySearch, setEntrySearch] = useState("");
  const entriesRef = React.useRef(null);

  /* ---- load once (with name-based expense remap on reseed) ---- */
  useEffect(() => {
    (async () => {
      await store.init();
      if (!store.loaded) {
        // Never seed or save anything unless the real ledger was read first —
        // otherwise a network blip could push a blank ledger over the real one.
        setLoadFailed(true); setLoading(false); return;
      }
      const ver = await store.get("ledger:catVersion");
      let cats = await store.get(K_CATS);
      let inc = await store.get(K_INC);
      let exps = (await store.get(K_EXP)) || [];
      const settings = (await store.get(K_SET)) || {};
      const mmap = (await store.get(K_MAP)) || {};
      const stmtsData = (await store.get(K_STMTS)) || {};
      const auditData = (await store.get(K_AUDIT)) || [];
      const creditData = (await store.get(K_CREDITS)) || [];
      const cmapData = (await store.get(K_CMAP)) || {};
      const goalsData = (await store.get(K_GOALS)) || [];
      const balData = (await store.get(K_BAL)) || {};

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
      const missingNS = NONSPEND_SEED.filter((nm) => !cats.some((c) => c.name === nm));
      const missingSp = SPEND_ADDITIONS.filter(([nm]) => !cats.some((c) => c.name === nm));
      if (missingSp.length) {
        cats = [...cats, ...missingSp.map(([name, section]) => ({ id: uid(), name, section, recurring: true, monthly: flat(0) }))];
        if (!missingNS.length) await store.set(K_CATS, cats);
      }
      if (missingNS.length) {
        cats = [...cats, ...missingNS.map((name) => ({ id: uid(), name, section: NONSPEND_SECTION, recurring: true, monthly: flat(0) }))];
        await store.set(K_CATS, cats);
      }

      setCategories(cats);
      setIncome(inc);
      setExpenses(exps);
      setMerchantMap(mmap);
      setStmts(stmtsData);
      setAuditLog(auditData);
      setCredits(creditData);
      setCreditMap(cmapData);
      setCardDue(settings.cardDue || {});
      setGoals(goalsData);
      setBalances(balData);
      setMonthStart(settings.monthStart || 1);
      setMonthStartState(settings.monthStart || 1);
      setSelMonth(currentPeriod());
      setSym(settings.sym || "₹");
      setApiOpen(store.protectedRemote === false);
      setLoading(false);
    })();

    const onSync = (e) => setSync(e.detail);
    // closing the tab with a save still in flight would lose it — ask first
    const onLeave = (e) => { if (store._timer || store.syncState === "saving") { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("ledger:sync", onSync);
    window.addEventListener("beforeunload", onLeave);
    return () => { window.removeEventListener("ledger:sync", onSync); window.removeEventListener("beforeunload", onLeave); };
  }, []);

  const saveCats = useCallback((n) => { setCategories(n); store.set(K_CATS, n); }, []);
  const saveExps = useCallback((n) => { setExpenses(n); store.set(K_EXP, n); }, []);
  const settingsNow = { sym, cardDue, monthStart };
  const saveSym = (s) => { setSym(s); store.set(K_SET, { ...settingsNow, sym: s }); };
  const saveCardDue = (n) => { setCardDue(n); store.set(K_SET, { ...settingsNow, cardDue: n }); };
  const saveMonthStart = (n) => {
    const v = Math.min(28, Math.max(1, parseInt(n, 10) || 1));
    setMonthStart(v); setMonthStartState(v); setSelMonth(currentPeriod());
    store.set(K_SET, { ...settingsNow, monthStart: v });
  };
  const saveGoals = (n) => { setGoals(n); store.set(K_GOALS, n); };
  const setBalance = (bank, entry) => {
    const n = { ...balances, [bank]: [entry, ...(balances[bank] || [])].slice(0, 12) };
    setBalances(n); store.set(K_BAL, n);
  };
  const saveCredits = useCallback((n) => { setCredits(n); store.set(K_CREDITS, n); }, []);
  const saveStmts = useCallback((n) => { setStmts(n); store.set(K_STMTS, n); }, []);
  const saveAudit = useCallback((n) => { setAuditLog(n); store.set(K_AUDIT, n); }, []);

  /* ---- derived ---- */
  const catById = useMemo(() => { const m = {}; categories.forEach((c) => (m[c.id] = c)); return m; }, [categories]);
  /* Refunds set against a category count as negative spend there. They live in
   * credits; these read-only rows let every total net them off. */
  const allExp = useMemo(() => [
    ...expenses,
    ...credits.filter((c) => c.kind === "refund" && c.cat).map((c) => ({
      id: "rf:" + c.id, creditId: c.id, cat: c.cat, amount: -c.amount, date: c.date,
      note: "Refund · " + (c.remark ? c.remark + " · " : "") + (c.note || ""), bank: c.bank, refund: true,
    })),
  ], [expenses, credits]);
  const monthExpenses = useMemo(() => allExp.filter((e) => periodOf(e.date) === selMonth), [allExp, selMonth]);
  const spentByCat = useMemo(() => { const m = {}; monthExpenses.forEach((e) => (m[e.cat] = (m[e.cat] || 0) + e.amount)); return m; }, [monthExpenses]);
  const fig = useMonthFigures({ expenses: allExp, categories, catById, selMonth });
  const alerts = useMemo(() => computeAlerts({ allExp, categories, catById, selMonth }), [allExp, categories, catById, selMonth]);

  const rows = useMemo(() => categories.map((c) => {
    const spent = spentByCat[c.id] || 0;
    const budget = budgetFor(c, selMonth);
    const ratio = budget > 0 ? spent / budget : spent > 0 ? Infinity : 0;
    let status = "ok";
    if (c.section === NONSPEND_SECTION) status = "tracked";
    else if (budget <= 0 && spent > 0) status = "unbudgeted";
    else if (ratio > 1) status = "over";
    else if (ratio >= 0.8) status = "caution";
    return { ...c, spent, budget, ratio, status };
  }), [categories, spentByCat, selMonth]);

  const orphanSpent = useMemo(
    () => monthExpenses.filter((e) => !catById[e.cat]).reduce((s, e) => s + e.amount, 0),
    [monthExpenses, catById]
  );

  /* grouped rows — used by Analysis and the shareable report */
  const grouped = useMemo(() => {
    const out = [];
    SECTIONS.forEach((sec) => {
      const all = rows.filter((r) => r.section === sec);
      if (!all.length) return;
      const vis = all.filter((r) => !(r.budget === 0 && r.spent === 0));
      if (!vis.length) return;
      out.push({
        section: sec,
        nonSpend: sec === NONSPEND_SECTION,
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
  }, [rows, orphanSpent]);

  const totalBudget = fig.budget;
  const totalSpent = fig.spent;
  const mi = useMemo(() => monthIncome(credits, selMonth), [credits, selMonth]);
  const totalIncome = mi.total;
  const net = totalIncome - totalSpent;
  const savingsRate = totalIncome > 0 ? (net / totalIncome) * 100 : 0;
  const overRows = rows.filter((r) => r.status === "over" || r.status === "unbudgeted");

  /* ---- actions ---- */
  const addExpense = ({ cat, amount, date, note, person = [], bank, tags }) => {
    if (!cat || !amount || amount <= 0 || !date) return;
    const entry = { id: uid(), cat, amount, date, note: note || "", src: "manual" };
    const tg = parseTags(tags);
    if (tg.length) entry.tags = tg;
    if (person.length) entry.person = person.join(",");
    if (bank) { entry.bank = bank; setLastBank(bank); try { localStorage.setItem("ledger:lastBank", bank); } catch {} }
    setExpenses((prev) => { const n = [entry, ...prev]; store.set(K_EXP, n); return n; });
    if (person.length) {
      setCatPersonMap((prev) => {
        const next = { ...prev, [cat]: person };
        try { localStorage.setItem("ledger:catPersonMap", JSON.stringify(next)); } catch {}
        return next;
      });
    }
    if (periodOf(date) !== selMonth) setSelMonth(periodOf(date));
  };
  const delExpense = (id) => {
    const e = expenses.find((x) => x.id === id);
    if (e && !window.confirm(`Delete ${money(e.amount, sym)} · ${catById[e.cat]?.name || "Uncategorised"} on ${e.date}?`)) return;
    saveExps(expenses.filter((x) => x.id !== id));
  };

  const startEdit = (e) => {
    setEditingId(e.id);
    setEditForm({ cat: e.cat, amount: String(e.amount), date: e.date, note: e.note || "", person: e.person || "", bank: e.bank || "", tags: (e.tags || []).join(" ") });
  };
  const cancelEdit = () => setEditingId(null);
  const saveEdit = () => {
    const amt = parseFloat(editForm.amount);
    if (!editForm.cat || !amt || amt <= 0 || !editForm.date) return;
    saveExps(expenses.map((e) => e.id === editingId
      ? { ...e, cat: editForm.cat, amount: amt, date: editForm.date, note: editForm.note.trim(), ...(editForm.person ? { person: editForm.person } : { person: undefined }), ...(editForm.bank ? { bank: editForm.bank } : { bank: undefined }), tags: parseTags(editForm.tags).length ? parseTags(editForm.tags) : undefined }
      : e
    ));
    setEditingId(null);
  };

  const backupData = () => {
    try {
      const data = {
        _meta: { app: "Manali's Ledger", exportedAt: new Date().toISOString(), version: CAT_VERSION, appVersion: APP_VERSION },
        "ledger:categories": categories,
        "ledger:income": income,
        "ledger:expenses": expenses,
        "ledger:settings": { sym },
        "ledger:merchantMap": merchantMap,
        "ledger:stmts": stmts,
        "ledger:catPersonMap": catPersonMap,
        "ledger:credits": credits,
        "ledger:goals": goals,
        "ledger:balances": balances,
        "ledger:creditMap": creditMap,
        "ledger:catVersion": CAT_VERSION,
      };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "manali-ledger-backup-" + todayISO() + ".json";
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
      mi.has ? `💰 Income received: ${fmt(totalIncome)}` : `💰 Income: awaiting bank statements`,
      `📋 Budgeted: ${fmt(totalBudget)}`,
      `💸 Spent: ${fmt(totalSpent)}`,
      ...(mi.has ? [`🏦 Saved: ${fmt(net)} (${savingsRate.toFixed(0)}%)`] : []),
      "",
      "*Category breakdown:*",
    ];
    grouped.forEach((g) => {
      if (g.nonSpend) {
        if (g.spent > 0) lines.push(`  _${g.section} (not counted in spend)_ — ${fmt(g.spent)}`);
        return;
      }
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

  const onImport = (newExpenses, newMap, bankSource, audit, newCredits = [], summary = null) => {
    if (summary && bankSource && (summary.balance != null || summary.amountDue != null)) setBalance(bankSource, { ...summary, src: "statement", at: new Date().toISOString() });
    if (newExpenses.length) saveExps([...newExpenses, ...expenses]);
    if (newCredits.length) saveCredits([...newCredits, ...credits]);
    if (newMap) { setMerchantMap(newMap); store.set(K_MAP, newMap); }
    const firstDate = newExpenses[0]?.date || newCredits[0]?.date;
    if (bankSource && firstDate) {
      const mk = periodOf(firstDate);
      const cur = stmts[mk] || [];
      if (!cur.includes(bankSource)) saveStmts({ ...stmts, [mk]: [...cur, bankSource] });
    }
    if (audit) saveAudit([audit, ...auditLog].slice(0, 300));
    setImportOpen(false);
    if (firstDate) setSelMonth(periodOf(firstDate));
    if (audit?.suspense) setView("suspense");
    else if (newCredits.some((c) => c.kind === "unsure")) setView("income");
  };

  /* Clearing a Suspense row is the moment merchant memory learns something —
   * the same payee should never land in Suspense twice for the same reason.
   * Learned under the payee-aware key the categoriser looks up. */
  const clearSuspense = (id, catId) => {
    const row = expenses.find((e) => e.id === id);
    if (!row || !catId) return;
    saveExps(expenses.map((e) => (e.id === id
      ? { ...e, cat: catId, prov: { layer: "manual", confidence: 1, reason: "cleared from Suspense" } }
      : e)));
    const mk = merchantKey(row.note);
    if (mk) { const m = { ...merchantMap, [mk]: catId }; setMerchantMap(m); store.set(K_MAP, m); }
    saveAudit([{
      id: uid(), at: new Date().toISOString(), kind: "suspense-cleared",
      note: row.note, amount: row.amount, bank: row.bank,
      to: categories.find((c) => c.id === catId)?.name || catId,
    }, ...auditLog].slice(0, 300));
  };

  /* Sorting a credit teaches the ledger that payer for next time (bank accounts only —
   * card-statement credits are always bill payments or refunds). */
  const setCreditKind = (id, kind) => {
    const c = credits.find((x) => x.id === id);
    if (!c) return;
    saveCredits(credits.map((x) => (x.id === id ? { ...x, kind, prov: "manual" } : x)));
    const mk = merchantKey(c.note);
    if (mk && BANKS.find((b) => b.key === c.bank)?.mode !== "card") {
      const m = { ...creditMap, [mk]: kind }; setCreditMap(m); store.set(K_CMAP, m);
    }
  };
  const addCredit = (c) => saveCredits([c, ...credits]);
  const setCreditRemark = (id, remark) => saveCredits(credits.map((x) => (x.id === id ? { ...x, remark: remark || undefined } : x)));
  const setCreditCat = (id, cat) => saveCredits(credits.map((x) => (x.id === id ? { ...x, cat: cat || undefined } : x)));
  /* Split one entry into several, one per category. The parts keep the date,
   * note, account and tags, and remember which entry they came from. */
  const splitEntry = (e, parts) => {
    const pieces = parts.map((p, i) => ({ ...e, id: uid(), cat: p.cat, amount: p.amount, splitOf: e.id, note: e.note, prov: { layer: "manual", confidence: 1, reason: `split ${i + 1}/${parts.length}` } }));
    const idx = expenses.findIndex((x) => x.id === e.id);
    const next = expenses.slice(); next.splice(idx, 1, ...pieces);
    saveExps(next); setSplitting(null);
  };
  const tagShown = (list, raw) => {
    const tg = parseTags(raw); if (!tg.length) return;
    const ids = new Set(list.filter((e) => !e.refund).map((e) => e.id));
    saveExps(expenses.map((e) => (ids.has(e.id) ? { ...e, tags: [...new Set([...(e.tags || []), ...tg])] } : e)));
    setTagAll("");
  };
  const delCredit = (id) => {
    const c = credits.find((x) => x.id === id);
    if (c && !window.confirm(`Delete the credit of ${money(c.amount, sym)} on ${c.date}?`)) return;
    saveCredits(credits.filter((x) => x.id !== id));
  };
  const editDueDay = (id, value) => {
    const d = parseInt(value, 10);
    saveCats(categories.map((c) => (c.id !== id ? c : (d >= 1 && d <= 31 ? { ...c, dueDay: d } : (({ dueDay, ...rest }) => rest)(c)))));
  };

  /* Bill due dates travel as a spreadsheet: download, fill in, upload. */
  const [dueMsg, setDueMsg] = useState(null);
  const CARD_BANKS = BANKS.filter((b) => b.mode === "card");
  const uploadDueSheet = async (file) => {
    if (!file) return;
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const name = wb.SheetNames.find((n) => /due/i.test(n) && !/how/i.test(n)) || wb.SheetNames[0];
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: "" });
      const { categories: next, cardDue: nextCard, report } = applyDueSheet(rows, categories, cardDue, CARD_BANKS);
      if (!report.bills && !report.notBills && !report.cards) { setDueMsg({ err: true, text: `Nothing to import from "${name}" — is this the Bill Due Dates sheet?` }); return; }
      saveCats(next); saveCardDue(nextCard);
      const bits = [`${report.bills} bills`, `${report.notBills} marked not a bill`, `${report.cards} card due days`];
      const warn = [
        ...report.problems,
        ...(report.unmatched.length ? [`No category named: ${report.unmatched.join(", ")}`] : []),
      ];
      setDueMsg({ err: warn.length > 0, text: `Imported ${bits.join(" · ")}.`, warn });
    } catch (err) {
      setDueMsg({ err: true, text: `Couldn't read that file: ${err.message || err}` });
    }
  };
  const downloadDueSheet = () => {
    const ws = XLSX.utils.aoa_to_sheet(dueSheetRows(categories, cardDue, CARD_BANKS, SECTIONS));
    ws["!cols"] = [18, 26, 15, 13, 11, 11, 11, 34].map((w) => ({ wch: w }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Due Dates");
    XLSX.writeFile(wb, "Bill Due Dates.xlsx");
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
  const addCategory = () =>
    saveCats([...categories, { id: uid(), name: "New category", section: "Lifestyle", recurring: true, monthly: flat(0) }]);
  const delCategory = (id) => {
    const c = catById[id];
    const n = expenses.filter((e) => e.cat === id).length;
    if (!window.confirm(n ? `Delete "${c.name}" and its ${n} logged expense${n > 1 ? "s" : ""}? (It can be brought back from History.)` : `Delete "${c.name}"?`)) return;
    saveCats(categories.filter((c) => c.id !== id));
    if (n) saveExps(expenses.filter((e) => e.cat !== id));
  };

  /* Clicking a budget row shows that category's entries below. */
  const pickBudgetRow = (r) => setDrill({ type: "cat", value: r.id, label: r.id === "__uncat__" ? "Uncategorised spend" : r.name });

  if (loading) return (<div className="ledger-root"><Styles /><div className="loading">Opening your ledger…</div></div>);

  if (loadFailed) return (
    <div className="ledger-root"><Styles />
      <div className="passgate">
        <div className="passcard">
          <h2>Couldn't load the ledger</h2>
          <p>The server didn't answer. Nothing has been changed. Check your connection and try again.</p>
          <button className="btn-add" onClick={() => window.dispatchEvent(new CustomEvent("ledger:reload"))}>Try again</button>
        </div>
      </div>
    </div>
  );

  const suspenseRows = expenses.filter((e) => e.cat === SUSPENSE_ID)
    .sort((a, b) => (b.date || "").localeCompare(a.date || "") || b.amount - a.amount);
  const stmtDone = (stmts[selMonth] || []).filter((k) => STMT_BANKS.some((b) => b.key === k)).length;
  const selIdxLabel = monthLabel(selMonth);
  const tabs = [
    ["dashboard", "Dashboard"], ["income", "Income"], ["calendar", "Calendar"], ["tags", "Trips & tags"], ["ask", "Ask"], ["analysis", "Analysis"],
    ["suspense", "Suspense"], ["history", "History"], ["audit", "Audit"],
  ];

  return (
    <div className="ledger-root">
      <Styles />

      <header className="mast2">
        <div className="mast-title">
          <span className="mast-mark"><Wallet size={18} strokeWidth={2.2} /></span>
          <div>
            <h1>Manali's Ledger</h1>
            <p>FY 2026–27 · budget vs. spend, month by month</p>
          </div>
        </div>

        <nav className="navtabs" aria-label="Sections">
          {tabs.map(([k, l]) => (
            <button key={k} className={view === k ? "on" : ""} aria-current={view === k ? "page" : undefined} onClick={() => setView(k)}>
              {l}{k === "suspense" && suspenseRows.length ? <span className="pill-count">{suspenseRows.length}</span> : null}
              {k === "income" && mi.unsure ? <span className="pill-count">{mi.unsure}</span> : null}
            </button>
          ))}
          <button onClick={() => setManageOpen(true)}>Budgets</button>
        </nav>

        <div className="mast-actions">
          <div className="monthnav">
            <button aria-label="Previous month" onClick={() => setSelMonth(shiftMonth(selMonth, -1))}><ChevronLeft size={18} /></button>
            <span className="monthnav-label">{periodLabel(selMonth)}</span>
            <button aria-label="Next month" onClick={() => setSelMonth(shiftMonth(selMonth, 1))}><ChevronRight size={18} /></button>
          </div>
          <button className={`btn-ghost stmt-badge ${stmtDone === STMT_BANKS.length ? "done" : "todo"}`} aria-expanded={stmtOpen} onClick={() => setStmtOpen((v) => !v)} title="Statements imported this month">
            {stmtDone === STMT_BANKS.length ? <Check size={15} /> : <TriangleAlert size={15} />} Statements <strong>{stmtDone}/{STMT_BANKS.length}</strong>
          </button>
          <button className="btn-dark" onClick={() => setImportOpen(true)}><Upload size={15} /> Import</button>
          <button className="btn-ghost" onClick={backupData} title="Download a full backup of your ledger as a JSON file"><Download size={15} /> {backupFlash ? "Saved!" : "Backup"}</button>
          <button className="btn-ghost" onClick={generateReport} title="Copy a WhatsApp-ready summary of this month"><ArrowUpRight size={15} /> {reportFlash ? "Copied!" : "Share"}</button>
          <button className="btn-ghost btn-logout" onClick={() => logout()} title="Save and lock the ledger on this device"><LogOut size={15} /> Log out</button>
        </div>
      </header>

      {stmtOpen && (
        <div className="stmt-pop">
          <StatementStatus stmts={stmts} selMonth={selMonth} onToggle={(key) => {
            const cur = stmts[selMonth] || [];
            const next = cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key];
            saveStmts({ ...stmts, [selMonth]: next });
          }} />
        </div>
      )}

      {apiOpen && (
        <div className="openwarn">
          <Info size={15} /> This ledger is readable and writable by anyone who knows its web address.
          Set <code>LEDGER_PASSCODE</code> in the Vercel project settings to lock it.
        </div>
      )}
      {sync === "error" && (
        <div className="alert"><TriangleAlert size={17} /> <span>Your last change couldn't be saved to the server. Check your connection — it will retry on your next change.</span></div>
      )}

      {view === "analysis" ? (
        <AnalysisView grouped={grouped} sym={sym} selMonth={selMonth} expenses={allExp} categories={categories} catById={catById} />
      ) : view === "suspense" ? (
        <SuspenseView rows={suspenseRows} categories={categories} sym={sym} onClear={clearSuspense}
                      onDelete={(id) => saveExps(expenses.filter((e) => e.id !== id))} />
      ) : view === "audit" ? (
        <AuditView log={auditLog} sym={sym} />
      ) : view === "history" ? (
        <HistoryView sym={sym} />
      ) : view === "income" ? (
        <IncomeView credits={credits} selMonth={selMonth} sym={sym} onSetKind={setCreditKind} onSetCat={setCreditCat} onSetRemark={setCreditRemark} onAdd={addCredit} onDelete={delCredit} categories={categories} />
      ) : view === "calendar" ? (
        <CalendarView allExp={allExp} credits={credits} categories={categories} expenses={allExp} cardDue={cardDue} balances={balances} catById={catById} selMonth={selMonth} sym={sym} />
      ) : view === "tags" ? (
        <TagsView allExp={allExp} catById={catById} sym={sym} onOpen={(t) => setDrill({ type: "tag", value: t, label: t })} />
      ) : view === "ask" ? (
        <AskView />
      ) : (<>
      <KpiStrip fig={fig} mi={mi} sym={sym} selMonth={selMonth} />
      <AlertsStrip alerts={alerts} sym={sym} onPick={(a) => setDrill(a.big ? { type: "merchant", value: merchantKey(a.name), label: a.name } : { type: "cat", value: a.id, label: a.name })} />

      <div className="cards">
        <PaceCard fig={fig} catById={catById} selMonth={selMonth} sym={sym} />
        <BillsCard categories={categories} expenses={allExp} credits={credits} cardDue={cardDue} balances={balances} selMonth={selMonth} sym={sym} onSetDue={() => setManageOpen(true)} />
      </div>
      <div className="cards">
        <BudgetsCard fig={fig} categories={categories} catById={catById} selMonth={selMonth} sym={sym}
          onPick={pickBudgetRow} onEditBudgets={() => setManageOpen(true)} />
        <StructureCard fig={fig} catById={catById} sym={sym} />
      </div>
      <div className="cards">
        <CashFlowCard expenses={allExp} credits={credits} categories={categories} cardDue={cardDue} balances={balances} catById={catById} selMonth={selMonth} sym={sym} />
        <PayeesCard fig={fig} catById={catById} sym={sym} onPick={setDrill} />
        <SetAsideCard categories={categories} selMonth={selMonth} sym={sym} />
      </div>
      <div className="cards">
        <BalancesCard balances={balances} credits={credits} sym={sym} onSet={setBalance} />
        <GoalsCard goals={goals} sym={sym} onSave={saveGoals} />
      </div>

      {/* entries */}
      <section className="panel" ref={entriesRef}>
        <div className="panel-head">
          <h2>{monthLabel(selMonth, { month: "long" })} entries <span className="sub num">· {monthExpenses.length}</span></h2>
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
          <div className="empty">No expenses logged for this month yet. Use “Add expense” or Import.</div>
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
              ...(e.tags || []).map((t) => "#" + t),
            ].join(" ").toLowerCase();
            return q.split(/\s+/).every((w) => hay.includes(w));
          });
          if (filtered.length === 0) {
            return <div className="empty">No entries match “{entrySearch}”.</div>;
          }
          return (<>
          {q && (
            <div className="tagall">
              <Tag size={14} /> Tag all {filtered.filter((e) => !e.refund).length} shown as
              <input value={tagAll} onChange={(ev) => setTagAll(ev.target.value)} placeholder="e.g. bangkok2026" onKeyDown={(ev) => ev.key === "Enter" && tagShown(filtered, tagAll)} aria-label="Tag to add" />
              <button className="btn-ghost sm" disabled={!tagAll.trim()} onClick={() => tagShown(filtered, tagAll)}>Add tag</button>
            </div>
          )}
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
                      <BankOptions />
                    </select>
                    <input className="en-edit-note" type="text" placeholder="Note" value={editForm.note} onChange={(ev) => setEditForm({ ...editForm, note: ev.target.value })} onKeyDown={(ev) => ev.key === "Enter" && saveEdit()} />
                    <input className="en-edit-note" type="text" placeholder="Tags, e.g. diwali bangkok2026" value={editForm.tags || ""} onChange={(ev) => setEditForm({ ...editForm, tags: ev.target.value })} onKeyDown={(ev) => ev.key === "Enter" && saveEdit()} aria-label="Tags" />
                    <div className="en-edit-btns">
                      <button className="icon-btn" aria-label="Save" onClick={saveEdit}><Check size={14} strokeWidth={2.5} style={{ color: "var(--teal)" }} /></button>
                      <button className="icon-btn" aria-label="Cancel" onClick={cancelEdit}><X size={14} /></button>
                    </div>
                  </li>
                );
              }
              return (
                <li key={e.id} className={e.refund ? "en-refund" : ""}>
                  <span className="en-date num">{e.date.slice(8, 10)} {monthLabel(e.date.slice(0, 7), { month: "short" })}</span>
                  <span className="en-cat">{catById[e.cat]?.name || "Uncategorised"}</span>
                  <span className="en-bank">{BANKS.find(b => b.key === e.bank)?.label || (e.src === "import" ? e.bank : "—")}</span>
                  <span className="en-note">{e.note || "—"}{e.splitOf && <span className="en-split">split</span>}{e.person && e.person.split(",").map((p) => <span key={p} className="person-tag">{p}</span>)}{(e.tags || []).map((t) => <button key={t} type="button" className="tag-chip" style={{ border: 0, cursor: "pointer" }} onClick={() => setDrill({ type: "tag", value: t, label: t })}>#{t}</button>)}</span>
                  <span className="en-amt num">{moneySigned(e.amount, sym)}</span>
                  {e.refund ? (
                    <span className="en-del" title="A refund — change it in the Income tab" style={{ gridColumn: "span 2", fontSize: 10.5, fontWeight: 600, color: "var(--teal)", width: "auto" }}>refund</span>
                  ) : (<>
                    <span className="en-btns">
                      <button className="en-del" aria-label="Split entry across categories" title="Split across categories" onClick={() => setSplitting(e)}><Scissors size={13} /></button>
                      <button className="en-del" aria-label="Edit entry" onClick={() => startEdit(e)}><Pencil size={13} /></button>
                    </span>
                    <button className="en-del" aria-label="Delete entry" onClick={() => delExpense(e.id)}><Trash2 size={14} /></button>
                  </>)}
                </li>
              );
            })}
          </ul>
          </>);
        })()}
      </section>
      </>)}

      <button className="fab" onClick={() => setQuickOpen(true)} aria-label="Add expense">
        <Plus size={22} strokeWidth={2.5} /> <span className="fab-label">Add expense</span>
      </button>

      {drill && <DrillDown filter={drill} allExp={allExp} catById={catById} sym={sym} onClose={() => setDrill(null)} />}
      {splitting && <SplitModal entry={splitting} categories={categories} sym={sym} onClose={() => setSplitting(null)} onSave={(parts) => splitEntry(splitting, parts)} />}

      {quickOpen && (
        <QuickAdd categories={categories} expenses={expenses} catPersonMap={catPersonMap} defaultBank={lastBank} sym={sym}
          onSave={addExpense} onClose={() => setQuickOpen(false)} />
      )}

      {importOpen && (
        <ImportWizard categories={categories} sym={sym} merchantMap={merchantMap} existing={expenses}
          existingCredits={credits} creditMap={creditMap}
          onClose={() => setImportOpen(false)} onImport={onImport} />
      )}

      <footer className="foot">
        Manali's Ledger v{APP_VERSION} · saved to the cloud, nothing kept on this device ·{" "}
        <span className={`sync${sync === "error" ? " error" : ""}`}>{sync === "saving" ? "Saving…" : sync === "error" ? "Not saved" : "All changes saved"}</span>
      </footer>

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
              <span>Month starts on day</span>
              <span className="ms-row" style={{ padding: 0 }}>
                <input type="number" min="1" max="28" value={monthStart} onChange={(e) => saveMonthStart(e.target.value)} aria-label="Month starts on day" />
                <span style={{ fontSize: 12, color: "var(--muted)" }}>{monthStart === 1 ? "calendar months" : `e.g. this month = ${periodLabel(currentPeriod())}`}</span>
              </span>
            </div>
            <div className="cur-row">
              <span>Currency</span>
              <div className="cur-pills">{CURRENCIES.map((c) => (<button key={c} className={c === sym ? "cur on" : "cur"} onClick={() => saveSym(c)}>{c.trim()}</button>))}</div>
            </div>

            <div className="due-io">
              <div className="due-io-head"><strong>Bill due dates</strong><span>Frequency, due day and month for each bill, kept in a spreadsheet.</span></div>
              <div className="due-io-btns">
                <label className="btn-ghost"><Upload size={15} /> Upload sheet
                  <input type="file" accept=".xlsx,.xls,.csv" hidden onChange={(e) => { uploadDueSheet(e.target.files?.[0]); e.target.value = ""; }} />
                </label>
                <button type="button" className="btn-ghost" onClick={downloadDueSheet}><Download size={15} /> Download current</button>
              </div>
              {dueMsg && (
                <div className={`due-msg${dueMsg.err ? " warn" : ""}`}>
                  {dueMsg.text}
                  {(dueMsg.warn || []).map((w) => <div key={w}>• {w}</div>)}
                </div>
              )}
            </div>

            {SECTIONS.map((sec) => {
              const list = categories.filter((c) => c.section === sec);
              if (!list.length) return null;
              return (
                <div className="cat-list" key={sec}>
                  <div className="cat-head"><span>{sec}</span><span>Budget</span><span /></div>
                  {list.map((c) => {
                    const bill = isBillCat(c);
                    const dd = bill ? dueDayOf({ ...c, dueDay: undefined }, expenses) : null;
                    return (
                    <div className="cat-edit-wrap" key={c.id}>
                      <div className="cat-edit">
                        <input value={c.name} onChange={(e) => editCatName(c.id, e.target.value)} />
                        <div className="amt-input sm"><span>{sym.trim()}</span><input type="number" min="0" value={c.monthly[mIdx(selMonth)] || 0} onChange={(e) => editCatAmount(c.id, e.target.value)} /></div>
                        <button className="icon-btn danger" aria-label="Delete" onClick={() => delCategory(c.id)}><Trash2 size={15} /></button>
                      </div>
                      {bill && (
                        <label className="due-row">Due on day
                          <input className="due-in" type="number" min="1" max="31" value={c.dueDay || ""} placeholder={dd ? String(dd.day) : "—"} onChange={(e) => editDueDay(c.id, e.target.value)} />
                          <span>{FREQS[c.freq] > 1
                            ? `· ${FREQ_LABEL[c.freq].toLowerCase()} — ${dueMonthsLabel(c)}${c.billAmt ? ` · ${money(c.billAmt, sym)} each` : ""}`
                            : c.dueDay ? "of the month" : dd ? `(usually paid by the ${ordinal(dd.day)} — leave blank to use that)` : "(not enough history yet)"}{c.autopay ? " · autopay" : ""}</span>
                        </label>
                      )}
                    </div>
                    );
                  })}
                </div>
              );
            })}

            <div className="cat-list">
              <div className="cat-head"><span>Credit card payment due dates</span><span /><span /></div>
              {BANKS.filter((b) => b.mode === "card").map((b) => (
                <label className="due-row" key={b.key} style={{ paddingLeft: 0 }}>{b.label}: due on day
                  <input className="due-in" type="number" min="1" max="31" value={cardDue[b.key] || ""} placeholder="—"
                    onChange={(e) => { const d = parseInt(e.target.value, 10); const n = { ...cardDue }; if (d >= 1 && d <= 31) n[b.key] = d; else delete n[b.key]; saveCardDue(n); }} />
                  <span>— the bill shown is last month's spend on the card</span>
                </label>
              ))}
            </div>

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
  const missing = STMT_BANKS.filter((b) => !uploaded.has(b.key));
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
        {STMT_BANKS.map((b) => {
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

  const nonSpend = (catId) => catById[catId]?.section === NONSPEND_SECTION;
  const spendExp = useMemo(() => expenses.filter((e) => !nonSpend(e.cat)), [expenses, catById]);
  const spendCats = useMemo(() => categories.filter((c) => c.section !== NONSPEND_SECTION), [categories]);
  const monthExp = useMemo(
    () => spendExp.filter((e) => periodOf(e.date) === selMonth),
    [spendExp, selMonth]
  );

  /* payment mode (this month): savings / credit card / cash */
  const modeData = useMemo(() => {
    const m = {};
    monthExp.forEach((e) => { const k = payModeOf(e.bank) || "__none__"; m[k] = (m[k] || 0) + e.amount; });
    return [...PAY_MODES.map((pm) => ({ key: pm.key, name: pm.label, spent: Math.round(m[pm.key] || 0) })),
            ...(m.__none__ ? [{ key: "__none__", name: "Unassigned", spent: Math.round(m.__none__) }] : [])];
  }, [monthExp]);

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
      spent: Math.round(spendExp.filter((e) => periodOf(e.date) === k).reduce((s, e) => s + e.amount, 0)),
      budget: Math.round(spendCats.reduce((s, c) => s + budgetFor(c, k), 0)),
    }));
  }, [spendExp, spendCats]);
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
        <div className="mode-strip">
          {modeData.map((d) => (
            <div className={`mode-chip${d.spent ? "" : " zero"}`} key={d.key}>
              <span className="mode-label">{d.name}</span>
              <span className="mode-val num">{fmtIN(d.spent)}</span>
              <span className="mode-pct num">{acctTotal > 0 ? Math.round((d.spent / acctTotal) * 100) : 0}%</span>
            </div>
          ))}
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

      <CategoryMoM expenses={expenses} categories={categories} catById={catById} selMonth={selMonth} sym={sym} />
      {grouped.filter((g) => !g.nonSpend).map((g) => {
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

/* Month-on-month spend per category across the FY. One row per category,
 * one column per month; switch between spent, budget and variance. */
function CategoryMoM({ expenses, categories, catById, selMonth, sym }) {
  const [metric, setMetric] = useState("spent"); // spent | budget | variance
  const [hideZero, setHideZero] = useState(true);
  const keys = useMemo(() => { const a = []; for (let k = FY_START; k <= FY_END; k = shiftMonth(k, 1)) a.push(k); return a; }, []);
  const short = (n) => {
    const v = Math.round(n || 0);
    if (!v) return "–";
    const a = Math.abs(v), sign = v < 0 ? "−" : "";
    if (a >= 100000) return `${sign}${(a / 100000).toFixed(a >= 1000000 ? 0 : 1)}L`;
    if (a >= 1000) return `${sign}${(a / 1000).toFixed(a >= 10000 ? 0 : 1)}k`;
    return `${sign}${a}`;
  };
  const full = (n) => `${n < 0 ? "−" : ""}${sym}${new Intl.NumberFormat("en-IN").format(Math.abs(Math.round(n || 0)))}`;

  const { sections, totals } = useMemo(() => {
    const spent = {}; // catId -> monthKey -> amt
    const inFYk = new Set(keys);
    expenses.forEach((e) => {
      const k = periodOf(e.date);
      if (!inFYk.has(k)) return;
      const id = catById[e.cat] ? e.cat : "__uncat__";
      if (!spent[id]) spent[id] = {};
      spent[id][k] = (spent[id][k] || 0) + e.amount;
    });
    const mk = (c, nonSpend) => {
      const cells = keys.map((k) => {
        const s = spent[c.id]?.[k] || 0;
        const b = c.id === "__uncat__" || nonSpend ? 0 : budgetFor(c, k);
        return { k, s, b, v: s - b };
      });
      const s = cells.reduce((a, x) => a + x.s, 0), b = cells.reduce((a, x) => a + x.b, 0);
      const active = cells.filter((x) => x.s > 0).length;
      return { id: c.id, name: c.name, nonSpend, cells, s, b, v: s - b, avg: active ? s / active : 0 };
    };
    const secs = [];
    SECTIONS.forEach((sec) => {
      const ns = sec === NONSPEND_SECTION;
      const rows = categories.filter((c) => c.section === sec).map((c) => mk(c, ns));
      if (rows.length) secs.push({ section: sec, nonSpend: ns, rows });
    });
    const other = categories.filter((c) => !SECTIONS.includes(c.section)).map((c) => mk(c, false));
    if (spent.__uncat__) other.push(mk({ id: "__uncat__", name: "Uncategorised spend" }, false));
    if (other.length) secs.push({ section: "Other", nonSpend: false, rows: other });
    const counted = secs.filter((g) => !g.nonSpend).flatMap((g) => g.rows);
    const tot = keys.map((k, i) => {
      const s = counted.reduce((a, r) => a + r.cells[i].s, 0), b = counted.reduce((a, r) => a + r.cells[i].b, 0);
      return { k, s, b, v: s - b };
    });
    const ts = tot.reduce((a, x) => a + x.s, 0), tb = tot.reduce((a, x) => a + x.b, 0);
    const active = tot.filter((x) => x.s > 0).length;
    return { sections: secs, totals: { cells: tot, s: ts, b: tb, v: ts - tb, avg: active ? ts / active : 0 } };
  }, [expenses, categories, catById, keys]);

  const val = (x) => metric === "spent" ? x.s : metric === "budget" ? x.b : x.v;
  const tone = (x, nonSpend) => {
    if (nonSpend || metric === "budget") return "";
    if (metric === "variance") return x.v > 0 ? "mom-over" : x.v < 0 ? "mom-under" : "";
    if (x.b > 0 && x.s > x.b) return "mom-over";
    if (x.b === 0 && x.s > 0) return "mom-over";
    if (x.b > 0 && x.s >= x.b * 0.8) return "mom-warn";
    return "";
  };
  const visible = (r) => !hideZero || r.s > 0 || (metric === "budget" && r.b > 0);
  const METRICS = [["spent", "Spent"], ["budget", "Budget"], ["variance", "Over / under"]];

  return (
    <div className="panel analysis-panel">
      <div className="analysis-sec-head mom-head">
        <span className="sec-name">Month on month · by category</span>
        <div className="mom-controls">
          <div className="seg-toggle" role="tablist">
            {METRICS.map(([k, l]) => (
              <button key={k} role="tab" aria-selected={metric === k} className={metric === k ? "on" : ""} onClick={() => setMetric(k)}>{l}</button>
            ))}
          </div>
          <button className="toggle" onClick={() => setHideZero((v) => !v)}>
            {hideZero ? <EyeOff size={13} /> : <Eye size={13} />}{hideZero ? "Hiding empty" : "Showing all"}
          </button>
        </div>
      </div>
      <div className="mom-scroll">
        <table className="mom-table num">
          <thead>
            <tr>
              <th className="mom-cat">Category</th>
              {keys.map((k) => <th key={k} className={k === selMonth ? "mom-sel" : ""}>{monthLabel(k, { month: "short" })}</th>)}
              <th className="mom-tot">FY total</th>
              <th className="mom-tot">Avg / mo</th>
            </tr>
          </thead>
          <tbody>
            {sections.map((g) => {
              const rows = g.rows.filter(visible);
              if (!rows.length) return null;
              return (
                <React.Fragment key={g.section}>
                  <tr className="mom-sec"><td colSpan={keys.length + 3}>{g.section}{g.nonSpend ? " · not counted in spend" : ""}</td></tr>
                  {rows.map((r) => (
                    <tr key={r.id} className={r.nonSpend ? "mom-ns" : ""}>
                      <td className="mom-cat" title={r.name}>{r.name}</td>
                      {r.cells.map((x) => (
                        <td key={x.k} className={`${tone(x, r.nonSpend)}${x.k === selMonth ? " mom-sel" : ""}`}
                            title={`${r.name} · ${monthLabel(x.k, { month: "short", year: "numeric" })}\nSpent ${full(x.s)}${r.nonSpend ? "" : ` · Budget ${full(x.b)}`}`}>
                          {short(val(x))}
                        </td>
                      ))}
                      <td className={`mom-tot ${tone(r, r.nonSpend)}`}>{short(val(r))}</td>
                      <td className="mom-tot">{metric === "spent" ? short(r.avg) : ""}</td>
                    </tr>
                  ))}
                </React.Fragment>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td className="mom-cat">Total spend</td>
              {totals.cells.map((x) => <td key={x.k} className={`${tone(x, false)}${x.k === selMonth ? " mom-sel" : ""}`} title={`Spent ${full(x.s)} · Budget ${full(x.b)}`}>{short(val(x))}</td>)}
              <td className={`mom-tot ${tone(totals, false)}`}>{short(val(totals))}</td>
              <td className="mom-tot">{metric === "spent" ? short(totals.avg) : ""}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="imp-note" style={{ marginTop: 8 }}>
        <Info size={13} /> Red = over that month's budget, amber = 80%+ used. Hover a cell for exact figures. Totals exclude Claims &amp; Transfers.
      </div>
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
function SuspenseView({ rows, categories, sym, onClear, onDelete }) {
  const [q, setQ] = useState("");
  const [pick, setPick] = useState({});
  const shown = rows.filter((r) => !q || (r.note || "").toLowerCase().includes(q.toLowerCase()));
  const total = rows.reduce((s, r) => s + r.amount, 0);

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Suspense</h2>
        <span className="sub num">{rows.length} entr{rows.length === 1 ? "y" : "ies"} · {money(total, sym)}</span>
      </div>
      {!rows.length ? (
        <div className="empty">Nothing in suspense — every imported transaction has a category.</div>
      ) : (<>
        <div className="imp-readnote">
          <Info size={14} /> These couldn't be matched to a category confidently, so they were parked here rather than guessed at.
          They already count towards the month's spend as "Uncategorised". Picking a category here also teaches the merchant memory,
          so the same payee won't come back to suspense.
        </div>
        <div className="rev-tools">
          <div className="rev-search"><Search size={14} /><input placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        </div>
        <div className="rev-list">
          {shown.map((r) => (
            <div className="rev-row" key={r.id}>
              <div className="rev-main">
                <span className="rev-desc">{r.note || "—"}</span>
                <span className="rev-meta num">{r.date} · {money(r.amount, sym)} · {r.bank || "—"}</span>
                {r.prov?.reason && <span className="susp-why">{r.prov.reason}</span>}
              </div>
              <CatSelect categories={categories} value={pick[r.id] || ""}
                onChange={(v) => { setPick({ ...pick, [r.id]: v }); onClear(r.id, v); }}
                hint="← file it" />
              <button className="btn-ghost sm" title="Remove this entry entirely"
                onClick={() => { if (window.confirm("Delete this entry? It will stop counting towards the month.")) onDelete(r.id); }}>
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          {!shown.length && <div className="empty">Nothing matches that filter.</div>}
        </div>
      </>)}
    </section>
  );
}

function AuditView({ log, sym }) {
  const runs = log.filter((r) => !r.kind);
  const clears = log.filter((r) => r.kind === "suspense-cleared");
  const csv = () => {
    const head = ["when","bank","file","month","found","imported","suspense","duplicates","total","extraction","balanceOk","balanceBreaks","layers"];
    const rows = runs.map((r) => [
      r.at, r.bank || "", r.file || "", r.month || "", r.found, r.imported, r.suspense, r.skippedAsDuplicate, r.total,
      r.extraction?.source || "", r.extraction?.balanceCheck ? (r.extraction.balanceCheck.ok ? "yes" : "no") : "n/a",
      r.extraction?.balanceCheck?.breaks ?? "", Object.entries(r.byLayer || {}).map(([k, v]) => k + ":" + v).join(" "),
    ]);
    const body = [head, ...rows].map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([body], { type: "text/csv" }));
    a.download = "ledger-audit.csv";
    a.click();
  };

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Audit trail</h2>
        <button className="btn-ghost sm" onClick={csv} disabled={!runs.length}><Download size={14} /> Export CSV</button>
      </div>
      {!log.length ? <div className="empty">No imports recorded yet.</div> : (
        <div className="audit-list">
          {runs.map((r) => (
            <div className="audit-run" key={r.id}>
              <div className="audit-top">
                <strong>{r.bank || "import"}</strong>
                <span className="num">{new Date(r.at).toLocaleString()}</span>
              </div>
              <div className="audit-body">
                <span>{r.file}</span>
                <span className="num">{r.imported} of {r.found} imported · {money(r.total, sym)}</span>
                {r.suspense > 0 && <span className="audit-warn">{r.suspense} to suspense</span>}
                {r.skippedAsDuplicate > 0 && <span>{r.skippedAsDuplicate} duplicates skipped</span>}
                {r.extraction && (
                  <span>read via {r.extraction.source}
                    {r.extraction.balanceCheck &&
                      (r.extraction.balanceCheck.ok
                        ? ` · balance verified across ${r.extraction.balanceCheck.checked} rows`
                        : ` · balance broke on ${r.extraction.balanceCheck.breaks} rows`)}
                  </span>
                )}
                <span className="audit-layers">
                  {Object.entries(r.byLayer || {}).map(([k, v]) => <span key={k} className={"prov-tag prov-" + k}>{k} {v}</span>)}
                </span>
              </div>
            </div>
          ))}
          {clears.length > 0 && (
            <div className="audit-run">
              <div className="audit-top"><strong>Suspense cleared</strong><span className="num">{clears.length} entries</span></div>
              <div className="audit-body">
                {clears.slice(0, 25).map((c) => (
                  <span key={c.id}>{new Date(c.at).toLocaleDateString()} · {(c.note || "").slice(0, 34)} → {c.to}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
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

/* OLE compound file (D0 CF 11 E0): a legacy .xls, or an encrypted .xlsx wrapper. */
const isOleFile = (buf) => { const b = new Uint8Array(buf, 0, Math.min(8, buf.byteLength)); return b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0; };
const fileToB64 = (f) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = () => rej(r.error); r.readAsDataURL(f); });
function ImportWizard({ categories, sym, merchantMap, existing, existingCredits = [], creditMap = {}, onClose, onImport }) {
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
  // Each SBI account and each card has its own statement password, remembered
  // separately (the old single box made SRP reuse Sid's password, and so on).
  // Falls back to the old shared key so nothing typed before is lost.
  const loadPwd = (acct, legacyKey) => { try { return localStorage.getItem(`ledger:${acct}Pwd`) || localStorage.getItem(legacyKey) || ""; } catch { return ""; } };
  const [sbiPwd, setSbiPwd] = useState(() => loadPwd("sbi_srp", "ledger:sbiPwd"));
  const [ccPwd, setCcPwd] = useState(() => loadPwd("hdfc_regalia", "ledger:ccPwd"));
  const [bomPwd, setBomPwd] = useState(() => { try { return localStorage.getItem("ledger:bomPwd") || ""; } catch { return ""; } });
  const [hdfcBankPwd, setHdfcBankPwd] = useState(() => { try { return localStorage.getItem("ledger:hdfcBankPwd") || ""; } catch { return ""; } });
  const [ubiPwd, setUbiPwd] = useState(() => { try { return localStorage.getItem("ledger:ubiPwd") || ""; } catch { return ""; } });
  const [genericPwd, setGenericPwd] = useState(""); // one-off, never saved
  const [ccCardType, setCcCardType] = useState("hdfc_regalia");
  const [sbiOwner, setSbiOwner] = useState("sbi_srp");
  const [genericBank, setGenericBank] = useState("");
  const [bankSource, setBankSource] = useState(null);
  const [dup, setDup] = useState({});
  const [personAssign, setPersonAssign] = useState({});
  const [progress, setProgress] = useState("");
  const [diag, setDiag] = useState(null);        // how the statement was read
  const [catSummary, setCatSummary] = useState(null); // how categorisation went
  const [autoBy, setAutoBy] = useState({});      // key -> {layer, confidence, reason, candidates}
  // Money in: every credit on the statement, sorted into a kind (see src/income.jsx)
  const [credTx, setCredTx] = useState([]);
  const [credKinds, setCredKinds] = useState({});
  const [credInclude, setCredInclude] = useState({});
  const [credDup, setCredDup] = useState({});
  const [credCats, setCredCats] = useState({});
  const [stmtSummary, setStmtSummary] = useState(null);
  const existingCreditKeys = useMemo(() => new Set(existingCredits.map(creditDupKey)), [existingCredits]);
  const stageCredits = (list, bank) => {
    const k = {}, inc = {}, dp = {}, cc = {};
    const out = list.map((t, i) => {
      const key = "c" + i;
      const cls = classifyCredit({ ...t, bank }, { creditMap, expenses: existing || [] });
      if (cls.kind === "refund") cc[key] = guessRefundCat(t.desc, existing);
      const isDup = existingCreditKeys.has(creditDupKey({ ...t, note: t.desc, bank }));
      k[key] = cls.kind; inc[key] = !isDup; dp[key] = isDup;
      return { ...t, key, reason: cls.reason };
    });
    setCredTx(out); setCredKinds(k); setCredInclude(inc); setCredDup(dp); setCredCats(cc);
  };
  const dupKey = (date, amount, desc) => `${date}|${Math.round(amount)}|${normMerchant(desc)}`;
  const existingKeys = useMemo(() => new Set((existing || []).map((e) => dupKey(e.date, e.amount, e.note))), [existing]);

  const toReview = (out, fromAPI, hasCredits = false) => {
    if (!out.length && !hasCredits) { setErr("No expense transactions were found. For tabular files, check the column mapping; for PDFs, try a clearer copy or a CSV/Excel export."); if (fromAPI) setStep("upload"); return; }
    const asg = {}, inc = {}, dp = {}, by = {};
    out.forEach((t) => {
      const isDup = existingKeys.has(dupKey(t.date, t.amount, t.desc));
      dp[t.key] = isDup; inc[t.key] = !isDup;
      if (t.auto && t.auto.cat) {
        asg[t.key] = t.auto.cat;
        by[t.key] = t.auto;
      } else if (t.auto) {
        by[t.key] = t.auto; // a refusal, with its reason and near misses
      } else {
        // tabular imports that never went through the categoriser
        const mk = normMerchant(t.desc);
        if (mk && merchantMap[mk]) asg[t.key] = merchantMap[mk];
      }
    });
    setTxns(out); setAssign(asg); setInclude(inc); setDup(dp); setPersonAssign({});
    setAutoBy(by); setViaAPI(!!fromAPI); setErr(""); setProgress(""); setStep("review");
  };

  const handleFile = async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    e.target.value = "";  // so choosing the same file again (e.g. after typing a password) still fires
    if (!genericBank) { setErr("Pick which bank / card this file is from first."); return; }
    setErr(""); setFileName(f.name);
    setBankSource(genericBank);
    const nm = f.name.toLowerCase();
    const isDoc = nm.endsWith(".pdf") || /\.(png|jpe?g|webp)$/.test(nm);
    try {
      if (isDoc) {
        if (!nm.endsWith(".pdf")) {
          setErr("Images aren't supported — upload the PDF statement itself, or a CSV/Excel export.");
          return;
        }
        await importStatement(f, genericBank, genericPwd.trim());
        return;
      }
      // A password was given: the server decrypts and reads the file (Excel or PDF).
      if (genericPwd.trim()) {
        await importStatement(f, genericBank, genericPwd.trim());
        return;
      }
      let parsed = [];
      if (nm.endsWith(".csv") || nm.endsWith(".txt")) {
        const text = await f.text();
        parsed = Papa.parse(text, { skipEmptyLines: "greedy" }).data;
      } else {
        const buf = await f.arrayBuffer();
        let wb;
        try { wb = XLSX.read(buf, { type: "array" }); }
        catch (xe) {
          // SheetJS can't open an encrypted workbook — ask for the password.
          if (/password|encrypt|ecma-376|cfb/i.test(String(xe && xe.message)) || isOleFile(buf)) {
            setErr("This spreadsheet is password protected — type its password in the box above, then choose the file again.");
            setStep("upload");
            return;
          }
          throw xe;
        }
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


  /* ------------------------------------------------------------------
   * One import path for every bank and card.
   *
   * The five handlers that used to live here each POSTed to /api/decrypt,
   * which was never deployed — so every one of them failed. They are replaced
   * by a single call to /api/extract, which decrypts the PDF server-side,
   * reads the money columns and verifies the running balance before handing
   * anything back.
   * ---------------------------------------------------------------- */
  const importStatement = async (file, bank, password) => {
    setErr(""); setFileName(file.name); setBankSource(bank);
    setStep("loading"); setProgress("Opening " + file.name + "…");
    try {
      const b64 = await fileToB64(file);
      const ex = await api("/api/extract", {
        method: "POST",
        body: JSON.stringify({ file: b64, password: password || "", bank, filename: file.name,
                               yearHint: new Date().getFullYear() }),
      });
      setDiag(ex.diagnostics || null);

      const debits = (ex.transactions || []).filter((t) => t.kind !== "credit");
      const creds = (ex.transactions || []).filter((t) => t.kind === "credit");
      if (!debits.length && !creds.length) {
        setErr("No transactions could be read from that statement.");
        setStep("upload");
        return;
      }
      stageCredits(creds.map((t) => ({ date: t.date, desc: t.description, amount: t.amount })), bank);
      // Statement figures for the balances card: closing balance = the last
      // running balance in the statement; card dues come from the summary box.
      {
        const withBal = (ex.transactions || []).filter((t) => t.balance != null && !isNaN(t.balance));
        const last = withBal.length ? withBal.reduce((a, t) => (t.date >= a.date ? t : a), withBal[0]) : null;
        const sm = ex.summary || {};
        const isCard = BANKS.find((b) => b.key === bank)?.mode === "card";
        const lastDate = (ex.transactions || []).reduce((m, t) => (t.date > m ? t.date : m), "");
        const summary = {
          asOf: sm.statementDate || (last && last.date) || lastDate || null,
          ...(isCard ? {} : { balance: sm.closingBalance ?? (last ? last.balance : null) }),
          ...(sm.amountDue != null ? { amountDue: sm.amountDue } : {}),
          ...(sm.minDue != null ? { minDue: sm.minDue } : {}),
          ...(sm.dueDate ? { dueDate: sm.dueDate } : {}),
          ...(sm.statementDate ? { statementDate: sm.statementDate } : {}),
          file: file.name,
        };
        setStmtSummary(summary.balance != null || summary.amountDue != null ? summary : null);
      }

      setProgress(`Categorising ${debits.length} transactions…`);
      let results = [];
      if (debits.length) try {
        const cat = await api("/api/categorize", {
          method: "POST",
          body: JSON.stringify({
            transactions: debits.map((t) => ({ description: t.description, amount: t.amount, bank, date: t.date })),
          }),
        });
        results = cat.results || [];
        setCatSummary(cat.summary || null);
      } catch (ce) {
        // categorisation is an accelerator, not a gate — fall back to manual
        setCatSummary({ error: String(ce.message || ce) });
      }

      const list = debits.map((t, i) => ({
        key: bank + i, date: t.date, desc: t.description, amount: t.amount,
        auto: results[i] || null,
      }));
      toReview(list, ex.diagnostics?.source === "claude", creds.length > 0);
    } catch (ex) {
      console.error(ex);
      setErr(String(ex.message || ex));
      setStep("upload");
    }
  };

  const onBankFile = (bank, pwdValue, pwdKey, optional = false) => async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    e.target.value = "";
    // A blank password is fine: the server falls back to the one saved in
    // Vercel for this account, and asks for it if there isn't one.
    const pwd = String(pwdValue || "").trim();
    if (pwdKey && pwd) { try { localStorage.setItem(pwdKey, pwd); } catch {} }
    await importStatement(f, bank, pwd);
  };

  const handleSBIFile = onBankFile(sbiOwner, sbiPwd, `ledger:${sbiOwner}Pwd`);
  const handleUBIFile = onBankFile("ubi", ubiPwd, "ledger:ubiPwd", true);
  const handleBOMFile = onBankFile("bom", bomPwd, "ledger:bomPwd", true);
  const handleHDFCBankFile = onBankFile("hdfc_bank", hdfcBankPwd, "ledger:hdfcBankPwd");
  const handleCCFile = onBankFile(ccCardType, ccPwd, `ledger:${ccCardType}Pwd`);

  const headerCells = rows[headerRow] || [];
  const colOpts = headerCells.map((h, i) => ({ i, label: colLabel(i, h) }));

  const buildTxns = () => {
    const out = [], creds = [];
    for (let r = headerRow + 1; r < rows.length; r++) {
      const row = rows[r]; if (!row) continue;
      const date = parseDate(row[map.date], dateFmt);
      const desc = String(map.desc >= 0 ? (row[map.desc] ?? "") : "").trim();
      if (!desc && !date) continue;
      let amount = NaN, credit = NaN;
      if (amountMode === "split") {
        amount = parseAmount(row[map.debit]);
        if (map.credit >= 0) credit = parseAmount(row[map.credit]);
      } else {
        const a = parseAmount(row[map.amount]);
        if (!isNaN(a)) { amount = (singleSign === "pos" ? a : -a); if (amount < 0) { credit = -amount; amount = NaN; } }
      }
      if (!isNaN(amount) && amount > 0) out.push({ key: r, date, desc, amount });
      else if (!isNaN(credit) && credit > 0 && date) creds.push({ date, desc, amount: credit });
    }
    stageCredits(creds, bankSource);
    toReview(out, false, creds.length > 0);
  };

  const visible = txns.filter((t) => {
    if (search && !t.desc.toLowerCase().includes(search.toLowerCase())) return false;
    if (onlyUnassigned && assign[t.key]) return false;
    return true;
  });
  const selectedTotal = txns.filter((t) => include[t.key]).reduce((s, t) => s + t.amount, 0);
  const dupCount = txns.filter((t) => dup[t.key]).length;

  const applyBulk = () => {
    if (!bulkCat) return;
    const next = { ...assign };
    visible.forEach((t) => { next[t.key] = bulkCat; });
    setAssign(next);
  };

  const doImport = () => {
    // Everything ticked is imported. A row with no category is not dropped and
    // does not block the batch — it goes to Suspense, where it still counts
    // against the month's spend until it is cleared.
    const picked = txns.filter((t) => include[t.key]);
    const pickedCredits = credTx.filter((t) => credInclude[t.key]);
    if (!picked.length && !pickedCredits.length) return;
    const newCredits = pickedCredits.map((t) => ({
      id: uid(), date: t.date, amount: t.amount, note: t.desc || "Credit", bank: bankSource,
      kind: credKinds[t.key], src: "import", prov: credKinds[t.key] === "unsure" ? "unsure" : "auto",
      ...(credKinds[t.key] === "refund" && credCats[t.key] ? { cat: credCats[t.key] } : {}),
    }));

    const expenses = picked.map((t) => {
      const cat = assign[t.key] || SUSPENSE_ID;
      const auto = autoBy[t.key];
      const manual = !auto || auto.cat !== assign[t.key];
      return {
        id: uid(), cat, amount: t.amount,
        date: t.date || new Date().toISOString().slice(0, 10),
        note: t.desc || "Imported", src: "import", bank: bankSource,
        ...(personAssign[t.key] && { person: personAssign[t.key] }),
        // provenance: how this row got the category it has
        prov: cat === SUSPENSE_ID
          ? { layer: "suspense", reason: auto?.reason || "not categorised at import" }
          : { layer: manual ? "manual" : auto.layer,
              confidence: manual ? 1 : auto.confidence,
              reason: manual ? "chosen at import" : auto.reason },
      };
    });

    // Merchant memory learns from what was actually confirmed — and only from
    // rows a human either chose or accepted, never from a Suspense row.
    let newMap = null;
    if (remember) {
      newMap = { ...merchantMap };
      picked.forEach((t) => {
        if (!assign[t.key]) return;
        const mk = normMerchant(t.desc);
        if (mk) newMap[mk] = assign[t.key];
      });
    }

    const byLayer = {};
    for (const e of expenses) byLayer[e.prov.layer] = (byLayer[e.prov.layer] || 0) + 1;
    const audit = {
      id: uid(),
      at: new Date().toISOString(),
      bank: bankSource,
      file: fileName,
      month: (expenses[0]?.date || newCredits[0]?.date || "").slice(0, 7),
      credits: newCredits.length,
      income: +newCredits.filter((c) => CREDIT_KINDS[c.kind]?.income).reduce((s, c) => s + c.amount, 0).toFixed(2),
      found: txns.length,
      imported: expenses.length,
      skippedAsDuplicate: txns.filter((t) => dup[t.key] && !include[t.key]).length,
      suspense: expenses.filter((e) => e.cat === SUSPENSE_ID).length,
      total: +expenses.reduce((s, e) => s + e.amount, 0).toFixed(2),
      byLayer,
      extraction: diag ? {
        source: diag.source, pages: diag.pages, columns: diag.columns,
        balanceCheck: diag.balanceCheck ? {
          checked: diag.balanceCheck.checked,
          ok: diag.balanceCheck.ok,
          breaks: diag.balanceCheck.breakCount,
        } : null,
      } : null,
      categoriser: catSummary || null,
    };

    onImport(expenses, newMap, bankSource, audit, newCredits, stmtSummary);
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
                <BankOptions list={STMT_BANKS} />
              </select>
            </div>
            <div className="sbi-row" style={{ flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
              <span className="person-label" style={{ fontWeight: 600 }}>File password:</span>
              <input
                type="password"
                className="sbi-pwd"
                placeholder="Only if the file is locked"
                value={genericPwd}
                onChange={(e) => setGenericPwd(e.target.value)}
              />
            </div>
            <label className="dropzone" style={!genericBank ? { opacity: .45, pointerEvents: "none" } : {}}>
              <FileSpreadsheet size={26} strokeWidth={1.6} />
              <span className="dz-title">Choose a CSV, Excel or PDF file</span>
              <span className="dz-sub">Password-protected PDF and Excel files are unlocked and read for you — no need to convert to CSV first.</span>
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
                <select className="sbi-pwd" style={{ flex: "0 0 auto", width: "auto" }} value={sbiOwner} onChange={(e) => { setSbiOwner(e.target.value); setSbiPwd(loadPwd(e.target.value, "ledger:sbiPwd")); }}>
                  <option value="sbi_srp">SBI SRP</option>
                  <option value="sbi_sid">SBI Sid</option>
                  <option value="sbi_mn">SBI MN</option>
                </select>
                <input
                  type="password"
                  className="sbi-pwd"
                  placeholder="Password (blank = use the one saved in Vercel)"
                  value={sbiPwd}
                  onChange={(e) => setSbiPwd(e.target.value)}
                />
                <label className="sbi-upload-btn">
                  Upload file
                  <input type="file" accept=".xlsx,.xls,.pdf" onChange={handleSBIFile} hidden />
                </label>
              </div>
              <div className="imp-note"><Info size={14} /> Select whose account, enter the password, then upload the locked Excel (.xlsx/.xls) or PDF as downloaded — no conversion needed. Each import marks that SBI account as done for the month.</div>
            </div>
            <div className="imp-divider">or</div>
            <div className="sbi-block">
              <div className="sbi-title"><FileSpreadsheet size={15} /> HDFC Credit Card Statement (PDF)</div>
              <div className="sbi-row" style={{ flexWrap: "wrap", gap: 8 }}>
                <select className="sbi-pwd" style={{ flex: "0 0 auto", width: "auto" }} value={ccCardType} onChange={(e) => { setCcCardType(e.target.value); setCcPwd(loadPwd(e.target.value, "ledger:ccPwd")); }}>
                  <option value="hdfc_regalia">Regalia (SIDD0971)</option>
                  <option value="hdfc_solitaire">MoneyBack (SARY5172)</option>
                </select>
                <input
                  type="password"
                  className="sbi-pwd"
                  placeholder="Password (blank = use the one saved in Vercel)"
                  value={ccPwd}
                  onChange={(e) => setCcPwd(e.target.value)}
                />
                <label className="sbi-upload-btn">
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
                  placeholder="Password (only if the file is locked)"
                  value={bomPwd}
                  onChange={(e) => setBomPwd(e.target.value)}
                />
                <label className="sbi-upload-btn">
                  Upload .pdf
                  <input type="file" accept=".pdf,.PDF" onChange={handleBOMFile} hidden />
                </label>
              </div>
              <div className="imp-note"><Info size={14} /> Password is saved in your browser. Debits become expenses; credits are recorded under Income (salary and rent count, transfers and refunds don't).</div>
            </div>
            <div className="imp-divider">or</div>
            <div className="sbi-block">
              <div className="sbi-title"><FileSpreadsheet size={15} /> Union Bank of India Statement (Excel or PDF)</div>
              <div className="sbi-row">
                <input
                  type="password"
                  className="sbi-pwd"
                  placeholder="Password (if the file is locked)"
                  value={ubiPwd}
                  onChange={(e) => setUbiPwd(e.target.value)}
                />
                <label className="sbi-upload-btn">
                  Upload .xlsx
                  <input type="file" accept=".xlsx,.xls,.pdf" onChange={handleUBIFile} hidden />
                </label>
              </div>
              <div className="imp-note"><Info size={14} /> Withdrawals become expenses and deposits are recorded under Income. UBI statements include your own category labels — these appear as descriptions.</div>
            </div>
            <div className="imp-divider">or</div>
            <div className="sbi-block">
              <div className="sbi-title"><FileSpreadsheet size={15} /> HDFC Bank Account Statement (PDF)</div>
              <div className="sbi-row">
                <input
                  type="password"
                  className="sbi-pwd"
                  placeholder="Password (blank = use the one saved in Vercel)"
                  value={hdfcBankPwd}
                  onChange={(e) => setHdfcBankPwd(e.target.value)}
                />
                <label className="sbi-upload-btn">
                  Upload .pdf
                  <input type="file" accept=".pdf" onChange={handleHDFCBankFile} hidden />
                </label>
              </div>
              <div className="imp-note"><Info size={14} /> Password is saved in your browser. Debits become expenses; credits (salary, rent, refunds) are recorded under Income. CC bill payments appear here AND in CC statements; skip the duplicates in the review step.</div>
            </div>
          </div>
        )}

        {step === "loading" && (
          <div className="imp-body">
            <div className="loadbox">
              <span className="spin" />
              <span className="dz-title">Reading {fileName}…</span>
              <span className="dz-sub">{progress || "Extracting transactions from your statement. This can take a few moments."}</span>
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
                <Field label="Credit / deposit (recorded as money in)"><ColSelect value={map.credit} opts={colOpts} onChange={(v) => setMap({ ...map, credit: v })} allowNone /></Field>
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
          const autoCount = txns.filter((t) => include[t.key] && assign[t.key] && autoBy[t.key]?.cat === assign[t.key]).length;
          const credCount = credTx.filter((t) => credInclude[t.key]).length;
          const canImport = includedCount > 0 || credCount > 0;
          return (
          <div className="imp-body">
            <div className="rev-summary">
              <strong>{txns.length}</strong> found · <strong>{includedCount}</strong> selected ({money(selectedTotal, sym)})
              {autoCount > 0 && <span style={{color:"var(--teal)"}}> · <strong>{autoCount}</strong> categorised automatically</span>}
              {uncatCount > 0 && <span className="rev-uncat"> · <strong>{uncatCount}</strong> → Suspense</span>}
              {dupCount > 0 && <span className="rev-dupnote"> · {dupCount} look already imported (unticked)</span>}
            </div>
            {diag?.balanceCheck && !diag.balanceCheck.ok && (
              <div className="imp-readnote" style={{background:"#FFF5F5",borderColor:"#F3C9C9",color:"#B4232A"}}>
                <Info size={14} /> The running balance doesn't add up on {diag.balanceCheck.breakCount} row
                {diag.balanceCheck.breakCount === 1 ? "" : "s"} — an amount may have been misread. Check those against the PDF before saving.
              </div>
            )}
            {uncatCount > 0 && (
              <div className="imp-readnote">
                <Info size={14} /> {uncatCount} transaction{uncatCount === 1 ? "" : "s"} couldn't be matched to a category with confidence.
                You can pick now, or save and clear them later from the Suspense tab — either way the money still counts towards this month.
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
                      hint={autoBy[t.key]?.reason || (needsCat ? "← pick a category" : "")} />
                    {autoBy[t.key] && (
                      <div className="prov-row">
                        {autoBy[t.key].cat === assign[t.key] && (
                          <span className={"prov-tag prov-" + autoBy[t.key].layer}>
                            {autoBy[t.key].layer} · {Math.round((autoBy[t.key].confidence || 0) * 100)}%
                          </span>
                        )}
                        {needsCat && (autoBy[t.key].candidates || []).slice(0, 3).map((c) => (
                          <button key={c.cat} type="button" className="prov-suggest"
                            onClick={() => setAssign({ ...assign, [t.key]: c.cat })}>
                            {categories.find((x) => x.id === c.cat)?.name || "?"}
                          </button>
                        ))}
                      </div>
                    )}
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
            {stmtSummary && (
              <div className="imp-readnote" style={{ background: "var(--teal-soft)", borderColor: "#BFE0D8", color: "var(--teal)" }}>
                <Info size={14} /> Statement figures saved to Balances:{stmtSummary.balance != null ? ` closing balance ${money(stmtSummary.balance, sym)}` : ""}{stmtSummary.amountDue != null ? ` amount due ${money(stmtSummary.amountDue, sym)}` : ""}{stmtSummary.dueDate ? ` by ${stmtSummary.dueDate}` : ""}.
              </div>
            )}
            <MoneyInReview items={credTx} kinds={credKinds} setKinds={setCredKinds} include={credInclude} setInclude={setCredInclude} dup={credDup} sym={sym} categories={categories} cats={credCats} setCats={setCredCats} />
            <label className="remember"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Remember these merchant → category choices and pre-fill them next time</label>
            <div className="imp-actions">
              <button className="btn-ghost" onClick={() => setStep("map")}>Back</button>
              <button className="btn-add" disabled={!canImport} onClick={doImport}>
                <Check size={16} /> {canImport
                  ? `Save ${includedCount} expense${includedCount === 1 ? "" : "s"}${uncatCount ? ` (${uncatCount} to Suspense)` : ""}${credCount ? ` + ${credCount} credit${credCount === 1 ? "" : "s"}` : ""}`
                  : "Select transactions above"}
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
.sec-nonspend .sec-name{color:var(--faint);}
.mode-strip{display:grid; grid-template-columns:repeat(auto-fit,minmax(130px,1fr)); gap:8px; margin:6px 0 10px;}
.mode-chip{display:flex; flex-direction:column; gap:2px; padding:8px 10px; border:1px solid var(--hairline); border-radius:10px; background:var(--bg);}
.mode-chip.zero{opacity:.55;}
.mode-label{font-size:11px; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); font-weight:600;}
.mode-val{font-size:15px; font-weight:600; color:var(--ink);}
.mode-pct{font-size:11px; color:var(--faint);}
.mom-head{flex-wrap:wrap; gap:8px;}
.mom-controls{display:flex; gap:8px; align-items:center; flex-wrap:wrap;}
.seg-toggle{display:inline-flex; border:1px solid var(--hairline); border-radius:8px; overflow:hidden;}
.seg-toggle button{border:0; background:transparent; padding:4px 10px; font:inherit; font-size:12px; color:var(--muted); cursor:pointer;}
.seg-toggle button + button{border-left:1px solid var(--hairline);}
.seg-toggle button.on{background:var(--ink); color:var(--surface);}
.mom-scroll{overflow-x:auto; margin:4px -4px 0; padding:0 4px;}
.mom-table{border-collapse:collapse; width:100%; font-size:12px; font-family:'JetBrains Mono',monospace; white-space:nowrap;}
.mom-table th{font-family:Inter,sans-serif; font-weight:600; font-size:11px; color:var(--muted); text-align:right; padding:6px 6px; border-bottom:1px solid var(--hairline);}
.mom-table td{text-align:right; padding:5px 6px; border-bottom:1px solid var(--hairline); color:var(--ink);}
.mom-table .mom-cat{text-align:left; font-family:Inter,sans-serif; position:sticky; left:0; background:var(--surface); max-width:170px; overflow:hidden; text-overflow:ellipsis; z-index:1;}
.mom-table .mom-tot{font-weight:600; border-left:1px solid var(--hairline);}
.mom-table th.mom-sel, .mom-table td.mom-sel{background:var(--teal-soft);}
.mom-table .mom-sec td{font-family:Inter,sans-serif; text-align:left; font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); padding-top:12px;}
.mom-table .mom-ns td{color:var(--faint);}
.mom-table td.mom-over{color:var(--red); font-weight:600;}
.mom-table td.mom-warn{color:var(--amber); font-weight:600;}
.mom-table td.mom-under{color:var(--teal);}
.mom-table tfoot td{font-weight:700; border-top:2px solid var(--ink); border-bottom:0;}
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
.entries li{display:grid; grid-template-columns:82px 1.05fr 120px 1.35fr auto 58px 30px; align-items:center; gap:12px; padding:11px 0; border-bottom:1px solid var(--hairline); font-size:13px;}
.entries li:last-child{border-bottom:0;}
.en-date{font-size:12px; color:var(--muted);}
.en-cat{font-weight:500;}
.en-note{color:var(--muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
.en-amt{text-align:right; font-weight:600;}
.en-btns{display:flex; gap:2px;}
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

/* ---- passcode gate ---- */
.passgate{min-height:70vh; display:flex; align-items:center; justify-content:center;}
.passcard{background:#fff; border:1px solid var(--hairline); border-radius:14px; padding:28px 26px; width:min(360px,92vw); display:flex; flex-direction:column; gap:12px; box-shadow:0 8px 30px rgba(0,0,0,.06);}
.passcard h2{margin:0; font-size:19px;}
.passcard p{margin:0; font-size:13px; color:var(--faint);}
.passcard input{padding:10px 12px; border:1px solid var(--hairline); border-radius:9px; font-size:15px;}

/* ---- open-API warning ---- */
.openwarn{display:flex; align-items:center; gap:8px; margin:0 0 14px; padding:10px 14px; border-radius:10px;
  background:#FFF5F5; border:1px solid #F3C9C9; color:#B4232A; font-size:13px; flex-wrap:wrap;}
.openwarn code{background:rgba(0,0,0,.05); padding:1px 5px; border-radius:4px; font-size:12px;}

/* ---- provenance tags ---- */
.pill-count{display:inline-block; margin-left:6px; min-width:18px; padding:0 5px; border-radius:9px;
  background:var(--amber,#B7791F); color:#fff; font-size:11px; line-height:18px; text-align:center;}
.prov-row{display:flex; gap:6px; align-items:center; flex-wrap:wrap; grid-column:1/-1; margin-top:2px;}
.prov-tag{font-size:10.5px; letter-spacing:.03em; text-transform:uppercase; padding:2px 7px; border-radius:20px;
  background:#EEF3F1; color:#4A6B60; border:1px solid #DCE7E3;}
.prov-memory{background:#E9F4EF; color:#1F6B4D; border-color:#CBE5D8;}
.prov-recurring{background:#EDF1FA; color:#33518F; border-color:#D3DDF2;}
.prov-fuzzy{background:#FBF3E6; color:#8A6224; border-color:#EEDFC4;}
.prov-ai{background:#F3EDFA; color:#63409B; border-color:#E1D4F2;}
.prov-manual{background:#F1F1F1; color:#555; border-color:#E2E2E2;}
.prov-suspense{background:#FDECEC; color:#A8323A; border-color:#F4D2D4;}
.prov-suggest{font-size:11.5px; padding:2px 9px; border-radius:20px; cursor:pointer;
  background:#fff; border:1px dashed var(--hairline); color:var(--ink);}
.prov-suggest:hover{border-style:solid; border-color:var(--teal); color:var(--teal);}
.susp-why{display:block; font-size:11.5px; color:var(--faint); margin-top:2px;}

/* ---- audit ---- */
.audit-list{display:flex; flex-direction:column; gap:10px; padding:4px 0;}
.audit-run{border:1px solid var(--hairline); border-radius:11px; padding:12px 14px; background:#fff;}
.audit-top{display:flex; justify-content:space-between; align-items:baseline; gap:10px; margin-bottom:6px;}
.audit-top .num{font-size:12px; color:var(--faint);}
.audit-body{display:flex; flex-direction:column; gap:3px; font-size:12.5px; color:var(--faint);}
.audit-warn{color:var(--amber,#B7791F); font-weight:600;}
.audit-layers{display:flex; gap:5px; flex-wrap:wrap; margin-top:5px;}
@media (max-width:640px){ .audit-top{flex-direction:column; gap:2px;} }
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
  .entries li{grid-template-columns:60px 1fr 92px auto 56px 28px;}
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
` + dashCss + incomeCss + featuresCss + `
.cat-edit-wrap{border-bottom:1px solid var(--hairline); padding-bottom:6px; margin-bottom:6px;}
.due-io{background:var(--surface); border:1px solid var(--hairline); border-radius:12px; padding:12px 14px; margin-bottom:14px; font-size:13px;}
.due-io-head{display:flex; flex-direction:column; gap:2px; margin-bottom:10px;}
.due-io-head span{font-size:12px; color:var(--muted);}
.due-io-btns{display:flex; flex-wrap:wrap; gap:8px;}
.due-io-btns label{cursor:pointer;}
.due-msg{margin-top:10px; font-size:12px; line-height:1.5; padding:8px 10px; border-radius:8px; background:color-mix(in srgb, var(--teal, #2a9d8f) 12%, transparent);}
.due-msg.warn{background:color-mix(in srgb, var(--amber, #e9a23b) 16%, transparent);}
.due-row{display:flex; align-items:center; flex-wrap:wrap; gap:6px; font-size:12px; color:var(--muted); padding:4px 0 2px 2px;}
.due-row input{height:30px; border:1px solid var(--hairline); border-radius:8px; padding:0 8px; font:500 12.5px 'JetBrains Mono',monospace; background:var(--surface); color:var(--ink);}
`}</style>);
}

export { money, moneySigned, monthLabel, shiftMonth, monthKey, budgetFor, mIdx, todayISO, uid, SECTIONS, NONSPEND_SECTION, SUSPENSE_ID, BANKS, BankOptions };
