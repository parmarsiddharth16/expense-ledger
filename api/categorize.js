import { requirePasscode } from "./_lib/auth.js";
import { resolveToken, readLedger, readJsonBody } from "./_lib/blob.js";
import { buildIndex, classify, neighbours, migrateMerchantMap } from "./_lib/categorize.js";
import { askClaude, hasKey } from "./_lib/ai.js";

/*
 * POST /api/categorize
 *   { transactions: [{description, amount, bank?, date?}], useAI?: boolean }
 * ->{ ok, results: [{cat, confidence, layer, reason, candidates}], summary }
 *
 * The ledger is read server-side, so the index always reflects what is actually
 * stored and the client never has to ship its history up with every request.
 *
 * Deterministic layers run first. Only the rows they refuse are shown to Claude,
 * in one batched call, together with the category list and the nearest entries
 * from the real history — so it learns the household's own scheme (Swiggy
 * Instamart is Grocery, plain Swiggy is Food & Travel) rather than applying
 * generic assumptions. Claude's answers are accepted only above 0.8 confidence;
 * anything below still goes to Suspense.
 */

const AI_SYSTEM = `You categorise household bank transactions into the user's OWN category list.
You are given their real filing history for similar merchants — follow the pattern it shows, even where it differs from what the category names would suggest in general.
Return ONLY a JSON array, one element per transaction, in the same order:
[{"i":<index>,"category":"<exact category name from the list, or null>","confidence":<0-1>,"why":"<max 12 words>"}]
Use null when you are genuinely unsure — an unfiled transaction is far better than a wrongly filed one.
Never invent a category name that is not in the list.`;

function salvage(text) {
  if (!text) return [];
  let s = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  const i = s.indexOf("[");
  if (i < 0) return [];
  s = s.slice(i);
  try { return JSON.parse(s); } catch {}
  const last = s.lastIndexOf("}");
  if (last > 0) { try { return JSON.parse(s.slice(0, last + 1) + "]"); } catch {} }
  return [];
}

export default async function handler(req, res) {
  if (!requirePasscode(req, res)) return;
  if (req.method !== "POST") { res.status(405).json({ ok: false, error: "Method not allowed" }); return; }

  try {
    const body = await readJsonBody(req);
    const txns = Array.isArray(body.transactions) ? body.transactions : [];
    if (!txns.length) { res.status(400).json({ ok: false, error: "No transactions supplied." }); return; }

    const token = resolveToken();
    const ledger = token ? await readLedger(token) : {};
    const categories = ledger["ledger:categories"] || [];
    const expenses = ledger["ledger:expenses"] || [];
    const merchantMap = ledger["ledger:merchantMap"] || {};

    if (!categories.length) {
      res.status(409).json({ ok: false, error: "No categories in the ledger yet." });
      return;
    }

    // Merchant memory is rebuilt from confirmed expenses under the payee-aware
    // key. The legacy map is passed in too, but only its entries that are still
    // valid under the new key survive — see migrateMerchantMap.
    const migrated = migrateMerchantMap({ expenses, categories, merchantMap });
    const ix = buildIndex({ expenses, categories, merchantMap: migrated.map });

    const results = txns.map((t) => classify(t, ix));

    // ---- AI layer over the refusals ----------------------------------------
    const useAI = body.useAI !== false && hasKey();
    let aiUsed = 0, aiError = null;
    if (useAI) {
      const idx = results.map((r, i) => (r.cat ? -1 : i)).filter((i) => i >= 0);
      if (idx.length) {
        const catNames = categories.map((c) => c.name);
        const byName = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]));
        const blocks = idx.map((i) => {
          const t = txns[i];
          const near = neighbours(t, ix, 6)
            .map((n) => `      "${n.text}" -> ${ix.byId.get(n.cat)?.name}`)
            .join("\n");
          return `  [${i}] ${t.date || ""} ${t.description} | ₹${t.amount} | account: ${t.bank || "?"}\n    similar entries you filed before:\n${near || "      (none)"}`;
        });
        try {
          const text = await askClaude({
            system: AI_SYSTEM,
            maxTokens: Math.min(8000, 400 + idx.length * 90),
            content: [{ type: "text", text:
              `Categories available:\n${catNames.map((n) => "  - " + n).join("\n")}\n\nTransactions to categorise:\n${blocks.join("\n\n")}` }],
          });
          for (const a of salvage(text)) {
            const i = Number(a && a.i);
            if (!Number.isInteger(i) || !results[i] || results[i].cat) continue;
            const id = a.category ? byName.get(String(a.category).toLowerCase()) : null;
            const conf = Number(a.confidence) || 0;
            if (id && conf >= 0.8) {
              results[i] = {
                cat: id, confidence: +conf.toFixed(2), layer: "ai",
                reason: String(a.why || "matched by Claude").slice(0, 80),
                candidates: results[i].candidates || [],
              };
              aiUsed++;
            }
          }
        } catch (e) {
          aiError = String(e.message || e);
        }
      }
    }

    const byLayer = {};
    for (const r of results) byLayer[r.layer] = (byLayer[r.layer] || 0) + 1;

    res.status(200).json({
      ok: true,
      results,
      summary: {
        total: results.length,
        assigned: results.filter((r) => r.cat).length,
        suspense: results.filter((r) => !r.cat).length,
        byLayer,
        aiUsed,
        aiAvailable: hasKey(),
        aiError,
        merchantMemory: { keys: migrated.kept, ambiguous: migrated.ambiguous.length, legacyKeys: migrated.droppedLegacy },
      },
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String((e && e.message) || e) });
  }
}
