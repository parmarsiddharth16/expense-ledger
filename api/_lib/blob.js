import { put, list, del } from "@vercel/blob";

/* Shared access to the single ledger.json blob that holds the whole ledger,
 * plus the snapshot files under history/ that make up its version history. */

export const KEY = "ledger.json";
export const HISTORY_KEY = "ledger:history"; // server-owned; never trusted from a client

/* The blob's URL is stable (no random suffix), so once we know it a warm
 * function can fetch it directly instead of paying for a list() call. */
let ledgerUrl = null;

export function resolveToken() {
  if (process.env.BLOB_READ_WRITE_TOKEN) return process.env.BLOB_READ_WRITE_TOKEN;
  const name = Object.keys(process.env).find(
    (k) => /READ_WRITE_TOKEN$/.test(k) && /BLOB/i.test(k)
  );
  return name ? process.env[name] : null;
}

export async function fetchJson(url, token) {
  const res = await fetch(url, {
    cache: "no-store",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!res.ok) throw new Error(`blob fetch ${res.status}`);
  return await res.json();
}

/* What this warm instance last wrote. The blob CDN can serve a just-overwritten
 * file stale for up to a minute, so within that window our own copy wins. */
let lastWritten = null;

export async function readLedger(token) {
  if (lastWritten && Date.now() - lastWritten.at < 90_000) return lastWritten.data;
  try {
    if (ledgerUrl) {
      try { return await fetchJson(ledgerUrl, token); } catch { ledgerUrl = null; }
    }
    const { blobs } = await list({ prefix: KEY, token });
    const blob = blobs.find((b) => b.pathname === KEY);
    if (!blob) return {};
    ledgerUrl = blob.url;
    return await fetchJson(blob.url, token);
  } catch {
    return {};
  }
}

export async function writeLedger(data, token) {
  const r = await put(KEY, JSON.stringify(data), {
    access: "private",
    contentType: "application/json",
    allowOverwrite: true,
    addRandomSuffix: false,
    cacheControlMaxAge: 60,
    token,
  });
  if (r && r.url) ledgerUrl = r.url;
  lastWritten = { at: Date.now(), data };
  return r;
}

/** Store a full copy of the ledger as one version. Returns { pathname, url }. */
export async function writeSnapshot(id, data, token) {
  const r = await put(`history/${id}.json`, JSON.stringify(data), {
    access: "private",
    contentType: "application/json",
    allowOverwrite: true,
    addRandomSuffix: false,
    token,
  });
  return { pathname: r.pathname, url: r.url };
}

export async function deleteBlobs(urls, token) {
  if (!urls.length) return;
  try { await del(urls, { token }); } catch { /* pruning is best-effort */ }
}

/** Read the body of a request whether the platform parsed it or not. */
export async function readJsonBody(req) {
  let body = req.body;
  if (body && typeof body === "object") return body;
  if (typeof body === "string") {
    try { return JSON.parse(body); } catch { return {}; }
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return {}; }
}
