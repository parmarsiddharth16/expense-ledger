import { HISTORY_KEY, writeSnapshot, deleteBlobs } from "./blob.js";

/*
 * Version history.
 *
 * Two layers, both kept by the server so no device can skip or rewrite them:
 *
 *   events     one line per save that changed something — which entries were
 *              added, removed or edited, whether budgets moved, from what
 *              kind of device. Lives inside ledger.json under "ledger:history".
 *   snapshots  a full copy of the ledger as it stood BEFORE a save, stored as
 *              history/<id>.json. Taken at most every SNAPSHOT_EVERY_MS, and
 *              always before anything large or destructive (an import, a
 *              batch delete, a restore). Restoring one brings the whole ledger
 *              back to that moment.
 */

const SNAPSHOT_EVERY_MS = 30 * 60 * 1000;
const MAX_EVENTS = 500;
const MAX_SNAPSHOTS = 60;

const KEY_LABELS = {
  "ledger:expenses": "entries",
  "ledger:categories": "budgets & categories",
  "ledger:income": "income plan",
  "ledger:merchantMap": "merchant memory",
  "ledger:stmts": "statement checklist",
  "ledger:settings": "settings",
  "ledger:audit": "import log",
  "ledger:credits": "money in",
  "ledger:creditMap": "money-in memory",
  "ledger:goals": "savings goals",
  "ledger:balances": "balances",
};

export function emptyHistory() {
  return { events: [], snapshots: [] };
}

export function getHistory(data) {
  const h = data && data[HISTORY_KEY];
  return h && Array.isArray(h.events) && Array.isArray(h.snapshots) ? h : emptyHistory();
}

export function withoutHistory(data) {
  const { [HISTORY_KEY]: _drop, ...rest } = data || {};
  return rest;
}

export function deviceOf(req) {
  const ua = String((req.headers && req.headers["user-agent"]) || "");
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android"
    : /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "";
  const br = /Edg\//.test(ua) ? "Edge" : /CriOS|Chrome\//.test(ua) ? "Chrome" : /FxiOS|Firefox\//.test(ua) ? "Firefox"
    : /Safari\//.test(ua) ? "Safari" : "";
  return [br, os].filter(Boolean).join(" on ") || "Unknown device";
}

const sameJSON = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** What changed between two copies of the ledger, in words a person can read. */
export function diffLedgers(before, after) {
  const catName = {};
  for (const c of after["ledger:categories"] || before["ledger:categories"] || []) catName[c.id] = c.name;
  const label = (e) => ({
    date: e.date, amount: Math.round(e.amount || 0),
    cat: catName[e.cat] || (e.cat === "__suspense__" ? "Suspense" : "Uncategorised"),
    note: String(e.note || "").slice(0, 60),
  });

  const old = new Map((before["ledger:expenses"] || []).map((e) => [e.id, e]));
  const neu = new Map((after["ledger:expenses"] || []).map((e) => [e.id, e]));
  const added = [], removed = [], edited = [];
  for (const [id, e] of neu) {
    const o = old.get(id);
    if (!o) added.push(e);
    else if (o.amount !== e.amount || o.cat !== e.cat || o.date !== e.date || (o.note || "") !== (e.note || "")
      || (o.person || "") !== (e.person || "") || (o.bank || "") !== (e.bank || "")) edited.push({ o, e });
  }
  for (const [id, e] of old) if (!neu.has(id)) removed.push(e);

  const other = [];
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (k === HISTORY_KEY || k === "ledger:expenses" || k === "ledger:catVersion") continue;
    if (!sameJSON(before[k], after[k])) other.push(KEY_LABELS[k] || k.replace(/^ledger:/, ""));
  }

  const sample = [
    ...added.slice(0, 6).map((e) => ({ t: "+", ...label(e) })),
    ...removed.slice(0, 6).map((e) => ({ t: "-", ...label(e) })),
    ...edited.slice(0, 6).map(({ o, e }) => ({
      t: "~", ...label(e),
      was: [o.amount !== e.amount ? `₹${Math.round(o.amount)}` : null,
            o.cat !== e.cat ? (catName[o.cat] || "Suspense") : null,
            o.date !== e.date ? o.date : null].filter(Boolean).join(", "),
    })),
  ];
  return {
    added: added.length, removed: removed.length, edited: edited.length,
    addedAmt: Math.round(added.reduce((s, e) => s + (e.amount || 0), 0)),
    removedAmt: Math.round(removed.reduce((s, e) => s + (e.amount || 0), 0)),
    other, sample,
    changed: added.length + removed.length + edited.length + other.length > 0,
  };
}

const newId = () => new Date().toISOString().replace(/[:.]/g, "-") + "-" + Math.random().toString(36).slice(2, 6);

/**
 * Called on every save, before the new ledger is written. Takes a snapshot of
 * `before` when one is due and returns the history to store with `after`.
 */
export async function recordSave({ before, after, diff, device, token, reason = "save", force = false }) {
  const h = getHistory(before);
  const events = h.events.slice();
  let snapshots = h.snapshots.slice();
  const hasBefore = Object.keys(withoutHistory(before)).length > 0;

  const last = snapshots[0];
  const due = !last || Date.now() - Date.parse(last.at) > SNAPSHOT_EVERY_MS;
  const big = diff.removed >= 3 || diff.added >= 15 || diff.other.includes("budgets & categories");
  let snapId = null;
  if (hasBefore && (force || due || big)) {
    const id = newId();
    const copy = withoutHistory(before);
    try {
      const { url, pathname } = await writeSnapshot(id, copy, token);
      snapshots.unshift({
        id, at: new Date().toISOString(), url, pathname, reason,
        expenses: (copy["ledger:expenses"] || []).length,
        note: reason === "restore" ? "Before restoring an older version"
          : big ? "Before a large change" : "Automatic checkpoint",
      });
      snapId = id;
    } catch { /* a failed snapshot must never block the save itself */ }
  }

  if (diff.changed || reason !== "save") {
    events.unshift({
      at: new Date().toISOString(), device, reason,
      added: diff.added, removed: diff.removed, edited: diff.edited,
      addedAmt: diff.addedAmt, removedAmt: diff.removedAmt,
      other: diff.other, sample: diff.sample, snapshot: snapId,
    });
  }

  const pruned = snapshots.slice(MAX_SNAPSHOTS);
  snapshots = snapshots.slice(0, MAX_SNAPSHOTS);
  if (pruned.length) await deleteBlobs(pruned.map((s) => s.url), token);

  return { events: events.slice(0, MAX_EVENTS), snapshots };
}
