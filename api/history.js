import { resolveToken, readLedger, writeLedger, readJsonBody, fetchJson, HISTORY_KEY } from "./_lib/blob.js";
import { requirePasscode } from "./_lib/auth.js";
import { diffLedgers, recordSave, withoutHistory, getHistory, deviceOf } from "./_lib/history.js";

/*
 * Version history of the ledger.
 *   GET  /api/history              -> { ok, events, snapshots }   (no blob URLs)
 *   GET  /api/history?id=<id>      -> { ok, snapshot, data }      one saved version
 *   POST /api/history {restore:id} -> { ok }  puts that version back; the state
 *                                     being replaced is snapshotted first, so a
 *                                     restore can itself be undone.
 */

export default async function handler(req, res) {
  if (!requirePasscode(req, res)) return;
  const token = resolveToken();
  if (!token) { res.status(501).json({ ok: false, error: "Blob storage not configured" }); return; }
  res.setHeader("Cache-Control", "no-store");

  try {
    const current = await readLedger(token);
    const h = getHistory(current);
    const pub = (s) => ({ id: s.id, at: s.at, reason: s.reason, note: s.note, expenses: s.expenses });

    if (req.method === "GET") {
      const id = req.query && req.query.id;
      if (!id) {
        res.status(200).json({ ok: true, events: h.events, snapshots: h.snapshots.map(pub) });
        return;
      }
      const snap = h.snapshots.find((s) => s.id === id);
      if (!snap) { res.status(404).json({ ok: false, error: "No such version." }); return; }
      const data = await fetchJson(snap.url, token);
      res.status(200).json({ ok: true, snapshot: pub(snap), data });
      return;
    }

    if (req.method === "POST") {
      const body = await readJsonBody(req);
      const snap = h.snapshots.find((s) => s.id === body.restore);
      if (!snap) { res.status(404).json({ ok: false, error: "No such version." }); return; }
      const restored = withoutHistory(await fetchJson(snap.url, token));
      if (!Object.keys(restored).length) { res.status(422).json({ ok: false, error: "That version is empty." }); return; }
      const diff = diffLedgers(withoutHistory(current), restored);
      diff.other = [...diff.other, `restored version from ${snap.at.slice(0, 16).replace("T", " ")} UTC`];
      const history = await recordSave({
        before: current, after: restored, diff, device: deviceOf(req), token, reason: "restore", force: true,
      });
      await writeLedger({ ...restored, [HISTORY_KEY]: history }, token);
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (e) {
    res.status(500).json({ ok: false, error: String((e && e.message) || e) });
  }
}
