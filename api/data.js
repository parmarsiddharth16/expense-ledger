import { put, list } from "@vercel/blob";

/*
 * Cloud persistence for the expense ledger.
 * Stores the entire app state as a single private JSON blob ("ledger.json").
 *   GET  /api/data   -> { ok: true, data: {...} }   (reads the blob)
 *   POST /api/data   -> { ok: true }                 (overwrites the blob)
 * Requires the BLOB_READ_WRITE_TOKEN env var, which Vercel injects
 * automatically once a Blob store is connected to the project.
 */

const KEY = "ledger.json";

async function readBlob() {
  try {
    const { blobs } = await list({ prefix: KEY });
    const blob = blobs.find((b) => b.pathname === KEY) || blobs[0];
    if (!blob) return {};
    const token = process.env.BLOB_READ_WRITE_TOKEN;
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
  // If the Blob store hasn't been connected yet, fail softly so the app
  // can fall back to local-only mode instead of crashing.
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    res.status(501).json({ ok: false, error: "Blob storage not configured" });
    return;
  }

  try {
    if (req.method === "GET") {
      const data = await readBlob();
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
      });
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (e) {
    res.status(500).json({ ok: false, error: String((e && e.message) || e) });
  }
}
