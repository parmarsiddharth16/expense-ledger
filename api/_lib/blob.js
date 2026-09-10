import { put, list } from "@vercel/blob";

/* Shared access to the single ledger.json blob that holds the whole ledger. */

export const KEY = "ledger.json";

export function resolveToken() {
  if (process.env.BLOB_READ_WRITE_TOKEN) return process.env.BLOB_READ_WRITE_TOKEN;
  const name = Object.keys(process.env).find(
    (k) => /READ_WRITE_TOKEN$/.test(k) && /BLOB/i.test(k)
  );
  return name ? process.env[name] : null;
}

export async function readLedger(token) {
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

export async function writeLedger(data, token) {
  await put(KEY, JSON.stringify(data), {
    access: "private",
    contentType: "application/json",
    allowOverwrite: true,
    addRandomSuffix: false,
    token,
  });
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
