import { resolveToken, readLedger, writeLedger, readJsonBody, HISTORY_KEY } from "./_lib/blob.js";
import { requirePasscode, isProtected } from "./_lib/auth.js";
import { diffLedgers, recordSave, withoutHistory, deviceOf } from "./_lib/history.js";

/*
 * Cloud persistence for the expense ledger — the whole app state as one private
 * JSON blob ("ledger.json").
 *   GET  /api/data -> { ok, data, protected }     (version history left out)
 *   POST /api/data -> { ok }
 *
 * Every POST is diffed against what is stored and logged to the version
 * history (see _lib/history.js) before it is written. The history key is owned
 * by the server: whatever a client sends under it is ignored.
 */

export default async function handler(req, res) {
  if (!requirePasscode(req, res)) return;

  const token = resolveToken();
  if (!token) {
    res.status(501).json({
      ok: false,
      error: "Blob storage not configured",
      envHints: Object.keys(process.env).filter((k) => /BLOB|READ_WRITE_TOKEN/i.test(k)),
    });
    return;
  }

  try {
    if (req.method === "GET") {
      const data = await readLedger(token);
      res.setHeader("Cache-Control", "no-store");
      res.status(200).json({ ok: true, data: withoutHistory(data), protected: isProtected() });
      return;
    }

    if (req.method === "POST" || req.method === "PUT") {
      const body = await readJsonBody(req);
      const raw = body && typeof body === "object" && body.data ? body.data : body || {};
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        res.status(400).json({ ok: false, error: "Expected an object body." });
        return;
      }
      const incoming = withoutHistory(raw);
      const current = await readLedger(token);
      // Refuse to overwrite a populated ledger with an empty one — a client that
      // failed to load its state must never be able to blank the blob.
      if (!Object.keys(incoming).length && Object.keys(withoutHistory(current)).length) {
        res.status(409).json({ ok: false, error: "Refusing to overwrite the ledger with empty data." });
        return;
      }
      const diff = diffLedgers(withoutHistory(current), incoming);
      if (!diff.changed && current[HISTORY_KEY]) {
        res.status(200).json({ ok: true, unchanged: true, protected: isProtected() });
        return;
      }
      const history = await recordSave({ before: current, after: incoming, diff, device: deviceOf(req), token });
      await writeLedger({ ...incoming, [HISTORY_KEY]: history }, token);
      res.status(200).json({ ok: true, protected: isProtected() });
      return;
    }

    res.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (e) {
    res.status(500).json({ ok: false, error: String((e && e.message) || e) });
  }
}
