/*
 * Merchant Memory — decide a category for a transaction, or refuse to.
 *
 * Layered, most certain first. Every answer carries the layer that produced it,
 * a confidence and a human-readable reason, so the audit trail can say *why* a
 * row was booked where it was. Refusing is a first-class outcome: a wrong
 * category is worse than an unfiled one, because a wrong one is invisible.
 *
 *   memory     this merchant key is settled in your history      0.80–0.97
 *   recurring  same amount, same account, month after month      0.92
 *   fuzzy      IDF-weighted token overlap with a known merchant  0.62–0.90
 *   ai         Claude, given your categories and near neighbours  its own
 *   suspense   nothing cleared the bar — you decide
 *
 * Measured against real history (train on everything before Aug 2026, test on
 * the 152 rows of Aug 2026): the deterministic layers auto-assign 84 rows at
 * 92% precision and send the rest to Suspense. The residual errors are merchants
 * that are genuinely split across two categories in the history — those are
 * surfaced as a choice rather than guessed at.
 *
 * NOTE ON THE OLD KEY. The app's original normMerchant took the first three
 * words of the narration, so every bank UPI withdrawal — "WDL TFR UPI/DR/
 * 611747685215/SANJAY P/BKID/" — collapsed to the key "WDL TFR UPI". 163 of the
 * 843 saved expenses sat under that one key across 14 different categories, and
 * merchant memory was filing all of them at 0.99 confidence off a coin flip.
 * merchantKey below finds the payee instead. See migrateMerchantMap.
 */

/* Payment-rail boilerplate: appears in thousands of narrations, says nothing
 * about who was paid. */
const STOP = new Set(`
TO FROM THE AND FOR VIA REF TXN TRAN TRANSFER TRF TFR PAID PAYMENT PAYMENTS
UPI IMPS NEFT RTGS MMT INB POS ATM WDL WITHDRAWAL CHQ CHEQUE CARD DEBIT CREDIT
DR CR PYU PUR PURCHASE MERCHANT ONLINE MOBILE BANKING NETBANKING ACH MANDATE
INDIA IND PVT PRIVATE LTD LIMITED LLP COMPANY SERVICES SERVICE SOLUTIONS
NBR NUM NOS NEW XXXXXXXX PAYBILL PAYTM COLLECT SENT RECEIVED
`.trim().split(/\s+/));

/* Bank and UPI handle codes that trail a payee in Indian narrations. */
const BANKCODE = new Set(`
BKID HDFC IDIB YESB AIRP ICIC SBIN UTIB KKBK PUNB BARB IOBA CNRB MAHB UBIN
IDFB RATN INDB FDRL DBSS SCBL CITI HSBC AXIS AXL YBL IBL PYTM PAYTMQR
OKAXIS OKHDFCBANK OKICICI OKSBI PTYS PTM APL UPIN
`.trim().split(/\s+/));

/* Cities get glued onto merchant names on card statements
 * ("SwiggyBENGALURU"), which would otherwise split one merchant into many. */
const CITIES = `BENGALURU BANGALORE MUMBAI DELHI GURGAON GURUGRAM PUNE CHENNAI
HYDERABAD NOIDA KOLKATA AHMEDABAD JAIPUR THANE SURAT LUCKNOW BHOPAL INDORE
NAGPUR KOCHI GOA BANGKOK DUBAI SINGAPORE LONDON INDIA`.trim().split(/\s+/);

function stripCity(t) {
  for (const c of CITIES) if (t.length > c.length + 2 && t.endsWith(c)) return t.slice(0, -c.length);
  return t;
}

/** The meaningful tokens of a narration — the payee, stripped of rail noise,
 *  reference numbers, bank codes and trailing city names. */
export function merchantTokens(desc) {
  const flat = (desc || "").toUpperCase()
    .split(/[/|\s]/).map((seg) => seg.split("@")[0]).join(" ");
  return [...new Set(
    flat.split(/[^A-Z0-9]+/).filter(Boolean)
      .filter((t) => !/^\d+$/.test(t))              // bare reference numbers
      .filter((t) => !(/\d/.test(t) && t.length > 4)) // PAYTMQR6M2D7O and friends
      .map(stripCity)
      .filter((t) => t.length > 2 && !STOP.has(t) && !BANKCODE.has(t))
  )];
}

/** Stable identity for a merchant. */
export function merchantKey(desc) {
  return merchantTokens(desc).slice(0, 3).join(" ");
}

/** The app's original key — kept only to read legacy merchantMap entries. */
export function legacyKey(desc) {
  return (desc || "").toUpperCase().replace(/[^A-Z ]/g, " ").split(/\s+/).filter((w) => w.length > 2).slice(0, 3).join(" ");
}

/* ---- index -------------------------------------------------------------- */

export function buildIndex({ expenses = [], categories = [], merchantMap = {} } = {}) {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const history = new Map();   // merchantKey -> Map(catId -> count)
  const df = new Map();
  const docs = [];
  const recurring = new Map(); // "bank|amount" -> Map(catId -> Set(month))

  const note = (e) => e.note || e.description || "";

  for (const e of expenses) {
    if (!e || !byId.has(e.cat)) continue;
    const k = merchantKey(note(e));
    if (k) {
      if (!history.has(k)) history.set(k, new Map());
      const h = history.get(k);
      h.set(e.cat, (h.get(e.cat) || 0) + 1);
    }
    const toks = merchantTokens(note(e));
    if (toks.length) {
      docs.push({ toks: new Set(toks), cat: e.cat, text: k || note(e) });
      for (const t of toks) df.set(t, (df.get(t) || 0) + 1);
    }
    const rk = `${e.bank || ""}|${Math.round(e.amount || 0)}`;
    if (!recurring.has(rk)) recurring.set(rk, new Map());
    const m = recurring.get(rk);
    if (!m.has(e.cat)) m.set(e.cat, new Set());
    m.get(e.cat).add(String(e.date || "").slice(0, 7));
  }

  // merchantMap entries already stored under the NEW key are trusted history too
  for (const [k, cat] of Object.entries(merchantMap || {})) {
    if (!byId.has(cat) || !k) continue;
    if (!history.has(k)) history.set(k, new Map());
    const h = history.get(k);
    h.set(cat, (h.get(cat) || 0) + 2); // an explicit choice outweighs one sighting
    const toks = merchantTokens(k);
    if (toks.length) {
      docs.push({ toks: new Set(toks), cat, text: k });
      for (const t of toks) df.set(t, (df.get(t) || 0) + 1);
    }
  }

  const N = Math.max(1, docs.length);
  return {
    categories, byId, history, docs, recurring, merchantMap,
    idf: (t) => Math.log(1 + N / (1 + (df.get(t) || 0))),
  };
}

/**
 * Rebuild merchant memory under the new key, from confirmed expenses.
 * Only unambiguous merchants are carried over; a key that has been filed under
 * more than one category is left out deliberately, so it reaches Suspense as a
 * choice instead of being auto-filed at high confidence.
 * @returns {{map:Object<string,string>, kept:number, ambiguous:string[], droppedLegacy:number}}
 */
export function migrateMerchantMap({ expenses = [], categories = [], merchantMap = {} } = {}) {
  const byId = new Set(categories.map((c) => c.id));
  const tally = new Map();
  for (const e of expenses) {
    if (!e || !byId.has(e.cat)) continue;
    const k = merchantKey(e.note || "");
    if (!k) continue;
    if (!tally.has(k)) tally.set(k, new Map());
    const t = tally.get(k);
    t.set(e.cat, (t.get(e.cat) || 0) + 1);
  }
  const map = {}, ambiguous = [];
  for (const [k, counts] of tally) {
    let top = null, topN = 0, total = 0;
    for (const [cat, n] of counts) { total += n; if (n > topN) { topN = n; top = cat; } }
    if (topN / total >= 0.85) map[k] = top;
    else ambiguous.push(k);
  }
  const legacyCount = Object.keys(merchantMap || {}).length;
  return { map, kept: Object.keys(map).length, ambiguous, droppedLegacy: legacyCount };
}

/* ---- classify ----------------------------------------------------------- */

const PARAMS = { purity: 0.85, minShared: 2, minScore: 0.5, minConfidence: 0.62 };

function topOf(counts) {
  let best = null, bestN = 0, total = 0;
  for (const [cat, n] of counts) { total += n; if (n > bestN) { bestN = n; best = cat; } }
  return { cat: best, share: total ? bestN / total : 0, n: bestN, total };
}

/**
 * @param {{description:string, amount:number, bank?:string, date?:string}} txn
 * @param {ReturnType<buildIndex>} ix
 * @returns {{cat:string|null, confidence:number, layer:string, reason:string, candidates:{cat:string,score:number}[]}}
 */
export function classify(txn, ix, opts = {}) {
  const P = { ...PARAMS, ...opts };
  const desc = txn.description || "";
  const toks = merchantTokens(desc);
  const key = toks.slice(0, 3).join(" ");
  const nameOf = (id) => (ix.byId.get(id)?.name) || id;

  // 1. settled history for this exact payee
  const hist = key && ix.history.get(key);
  if (hist && hist.size) {
    const t = topOf(hist);
    if (t.share >= P.purity) {
      return {
        cat: t.cat,
        confidence: +Math.min(0.97, 0.8 + 0.05 * Math.min(3, t.n)).toFixed(2),
        layer: "memory",
        reason: `"${key}" filed as ${nameOf(t.cat)} ${t.n} of the last ${t.total} times`,
        candidates: [],
      };
    }
    // known payee, but you have split it across categories — always your call
    return {
      cat: null, confidence: 0, layer: "suspense",
      reason: `"${key}" has gone to ${hist.size} different categories before`,
      candidates: [...hist.entries()].sort((a, b) => b[1] - a[1])
        .map(([cat, n]) => ({ cat, score: +(n / t.total).toFixed(2) })),
    };
  }

  // 2. a fixed recurring amount from the same account
  const rec = ix.recurring.get(`${txn.bank || ""}|${Math.round(txn.amount || 0)}`);
  if (rec) {
    let bestCat = null, months = 0;
    for (const [cat, ms] of rec) if (ms.size > months) { months = ms.size; bestCat = cat; }
    if (months >= 2 && rec.size === 1) {
      return {
        cat: bestCat, confidence: 0.92, layer: "recurring",
        reason: `₹${Math.round(txn.amount)} from this account in ${months} previous months, always ${nameOf(bestCat)}`,
        candidates: [],
      };
    }
  }

  // 3. fuzzy — needs a strong score AND at least two shared meaningful tokens,
  //    because a single shared token is usually just a common first name
  let near = [];
  if (toks.length) {
    const qw = new Map(toks.map((t) => [t, ix.idf(t)]));
    const qNorm = Math.sqrt([...qw.values()].reduce((a, b) => a + b * b, 0)) || 1;
    const scores = new Map();
    let best = { score: 0, cat: null, shared: 0, text: "" };
    for (const doc of ix.docs) {
      let dot = 0, dNorm = 0, shared = 0;
      for (const t of doc.toks) {
        const w = ix.idf(t);
        dNorm += w * w;
        if (qw.has(t)) { dot += w * qw.get(t); shared++; }
      }
      if (!dot) continue;
      const score = dot / (qNorm * (Math.sqrt(dNorm) || 1));
      const prev = scores.get(doc.cat);
      if (!prev || score > prev.score) scores.set(doc.cat, { score, shared, text: doc.text });
      if (score > best.score || (score === best.score && shared > best.shared)) {
        best = { score, cat: doc.cat, shared, text: doc.text };
      }
    }
    const ranked = [...scores.entries()].sort((a, b) => b[1].score - a[1].score);
    near = ranked.slice(0, 3).map(([cat, v]) => ({ cat, score: +v.score.toFixed(2) }));
    if (best.cat && best.score >= P.minScore && best.shared >= P.minShared) {
      const margin = ranked.length > 1 ? ranked[0][1].score - ranked[1][1].score : ranked[0][1].score;
      const conf = Math.min(0.9, 0.4 + 0.5 * best.score + 0.35 * margin);
      if (conf >= P.minConfidence) {
        return {
          cat: best.cat, confidence: +conf.toFixed(2), layer: "fuzzy",
          reason: `closest known merchant is "${best.text}" (${Math.round(best.score * 100)}% match)`,
          candidates: near,
        };
      }
    }
  }

  // 4. nothing cleared the bar
  return {
    cat: null, confidence: 0, layer: "suspense",
    reason: near.length
      ? `nothing close enough — nearest is ${nameOf(near[0].cat)} at ${Math.round(near[0].score * 100)}%`
      : "no similar merchant anywhere in your history",
    candidates: near,
  };
}

/** Neighbours to show Claude when asking it to adjudicate a Suspense row. */
export function neighbours(txn, ix, n = 12) {
  const toks = merchantTokens(txn.description || "");
  if (!toks.length) return [];
  const qw = new Map(toks.map((t) => [t, ix.idf(t)]));
  const qNorm = Math.sqrt([...qw.values()].reduce((a, b) => a + b * b, 0)) || 1;
  const out = [];
  for (const doc of ix.docs) {
    let dot = 0, dNorm = 0;
    for (const t of doc.toks) { const w = ix.idf(t); dNorm += w * w; if (qw.has(t)) dot += w * qw.get(t); }
    if (dot) out.push({ text: doc.text, cat: doc.cat, score: dot / (qNorm * (Math.sqrt(dNorm) || 1)) });
  }
  const seen = new Set();
  return out.sort((a, b) => b.score - a.score).filter((d) => {
    const k = d.text + "|" + d.cat;
    if (seen.has(k)) return false;
    seen.add(k); return true;
  }).slice(0, n);
}

export const PARAMS_DEFAULT = PARAMS;
