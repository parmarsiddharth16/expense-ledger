import { resolveToken, readLedger, writeLedger, readJsonBody } from "./_lib/blob.js";
import { requirePasscode, isProtected } from "./_lib/auth.js";

/*
 * Cloud persistence for the expense ledger — the whole app state as one private
 * JSON blob ("ledger.json").
 *   GET  /api/data -> { ok, data, protected }
 *   POST /api/data -> { ok }
 *
 * Both are behind the passcode gate once LEDGER_PASSCODE is set; until then the
 * response carries protected:false so the app can warn that the ledger is open.
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
      res.status(200).json({ ok: true, data, protected: isProtected() });
      return;
    }

    if (req.method === "POST" || req.method === "PUT") {
      const body = await readJsonBody(req);
      const data = body && typeof body === "object" && body.data ? body.data : body || {};
      if (!data || typeof data !== "object" || Array.isArray(data)) {
        res.status(400).json({ ok: false, error: "Expected an object body." });
        return;
      }
      // Refuse to overwrite a populated ledger with an empty one — a client that
      // failed to load its state must never be able to blank the blob.
      if (!Object.keys(data).length) {
        const current = await readLedger(token);
        if (Object.keys(current).length) {
          res.status(409).json({ ok: false, error: "Refusing to overwrite the ledger with empty data." });
          return;
        }
      }
      await writeLedger(data, token);
      res.status(200).json({ ok: true, protected: isProtected() });
      return;
    }

    res.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (e) {
    res.status(500).json({ ok: false, error: String((e && e.message) || e) });
  }
}
