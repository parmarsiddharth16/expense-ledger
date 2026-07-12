import { put, list } from "@vercel/blob";

/*
 * Cloud persistence for the expense ledger.
 * Stores the entire app state as a single private JSON blob ("ledger.json").
 *   GET  /api/data   -> { ok: true, data: {...} }   (reads the blob)
 *   POST /api/data   -> { ok: true }                 (overwrites the blob)
 *
 * Requires a Vercel Blob read/write token. Vercel injects this when a Blob
 * store is connected to the project. The default name is BLOB_READ_WRITE_TOKEN,
 * but a *named* store gets a prefixed variable (e.g. mystore_READ_WRITE_TOKEN),
 * so we resolve whichever one is present.
 */

const KEY = "ledger.json";

function resolveToken() {
  if (process.env.BLOB_READ_WRITE_TOKEN) return process.env.BLOB_READ_WRITE_TOKEN;
  // fall back to any Vercel Blob token variable, whatever its prefix
  const name = Object.keys(process.env).find(
    (k) => /READ_WRITE_TOKEN$/.test(k) && /BLOB/i.test(k)
  );
  return name ? process.env[name] : null;
}

async function readBlob(token) {
  try {
    const { blobs } = await list({ prefix: KEY, token });
    const blob = blobs.find((b) => b.pathname === KEY) || blobs[0];
    if (!blob) return {};
    const res = await fetch(blob.url, {
      cache: "no-store",
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (!res.ok) return {};
    return await res.json();
  } catch {
    return {};
  }
}

export default async function handler(req, res) {
  const token = resolveToken();

  // If no Blob token is present, fail softly so the app falls back to
  // local-only mode. Include the NAMES (never values) of blob-related env
  // vars to make misconfiguration easy to diagnose.
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
      const data = await readBlob(token);
      res.setHeader("Cache-Control", "no-store");
      res.status(200).json({ ok: true, data });
      return;
    }

    if (req.method === "POST" || req.method === "PUT") {
      let body = req.body;
      if (typeof body === "string") {
        try { body = JSON.parse(body); } catch { body = {}; }
      }
      const data = body && typeof body === "object" && body.data ? body.data : body || {};
      await put(KEY, JSON.stringify(data), {
        access: "private",
        contentType: "application/json",
        allowOverwrite: true,
        addRandomSuffix: false,
        token,
      });
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (e) {
    res.status(500).json({ ok: false, error: String((e && e.message) || e) });
  }
}
