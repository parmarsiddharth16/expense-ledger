import crypto from "crypto";

/*
 * Read-only access to the statements folder in Google Drive, through a Google
 * service account.
 *
 * Setup (once): create a service account, download its JSON key, save the whole
 * JSON in Vercel as GOOGLE_SA_KEY (plain JSON or base64 of it), and share the
 * Drive folder "Manali's Ledger/Statements" with the service account's email as
 * Viewer. The account can then see that folder and nothing else in the Drive.
 *
 * The key never leaves the server. Only file names, sizes and ids go to the
 * browser; the bytes are fetched here and handed straight to the extractor.
 */

export const STATEMENTS_FOLDER =
  process.env.DRIVE_STATEMENTS_FOLDER_ID || "1gmCRNTtSxL33Db8Mr_RSqSDlQ28PVmFx";

const SCOPE = "https://www.googleapis.com/auth/drive.readonly";
const API = "https://www.googleapis.com/drive/v3";

export class DriveNotConfigured extends Error {}

function parseKey(raw) {
  // Tolerate how the JSON tends to arrive after a paste: a byte-order mark,
  // surrounding quotes, the JSON stored as a JSON string, or base64 of it.
  let s = String(raw || "").replace(/^\uFEFF/, "").trim();
  const tries = [s];
  if (/^(['"]).*\1$/s.test(s)) tries.push(s.slice(1, -1).trim());
  if (!s.startsWith("{")) { try { tries.push(Buffer.from(s, "base64").toString("utf8").replace(/^\uFEFF/, "").trim()); } catch {} }
  for (const t of tries) {
    try {
      let k = JSON.parse(t);
      if (typeof k === "string") k = JSON.parse(k);
      if (k && typeof k === "object") return k;
    } catch {}
  }
  return null;
}

function describe(raw) {
  // Shape only — never any of the value itself.
  const s = String(raw || "").trim();
  const start = s.startsWith("{") ? "starts with {" : s.startsWith('"') ? "starts with a quote" : "doesn't start with {";
  const end = s.endsWith("}") ? "ends with }" : "doesn't end with }";
  return `${s.length} characters, ${start}, ${end}`;
}

function loadKey() {
  const raw = String(process.env.GOOGLE_SA_KEY || "");
  if (!raw.trim()) throw new DriveNotConfigured("Google Drive isn't connected yet — GOOGLE_SA_KEY is not set in Vercel.");
  const k = parseKey(raw);
  if (!k) throw new DriveNotConfigured(`GOOGLE_SA_KEY in Vercel isn't valid service-account JSON (${describe(raw)}). Paste the whole contents of the downloaded .json key file.`);
  if (!k.client_email || !k.private_key) throw new DriveNotConfigured("GOOGLE_SA_KEY is missing client_email or private_key — is it the service-account key file?");
  return { email: k.client_email, key: String(k.private_key).replace(/\\n/g, "\n") };
}

export function serviceAccountEmail() {
  try { return loadKey().email; } catch { return null; }
}

const b64url = (b) => Buffer.from(b).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

let cached = null; // { token, exp } — reused while a warm function lives

async function accessToken() {
  if (cached && cached.exp - 60 > Date.now() / 1000) return cached.token;
  const { email, key } = loadKey();
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({
    iss: email, scope: SCOPE, aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
  }));
  const sig = b64url(crypto.createSign("RSA-SHA256").update(head + "." + claim).sign(key));
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: head + "." + claim + "." + sig,
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error("Google sign-in for Drive failed: " + (j.error_description || j.error || r.status));
  cached = { token: j.access_token, exp: now + (j.expires_in || 3600) };
  return cached.token;
}

async function gget(path, params) {
  const t = await accessToken();
  const url = API + path + (params ? "?" + new URLSearchParams(params) : "");
  const r = await fetch(url, { headers: { Authorization: "Bearer " + t } });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    const e = new Error("Drive: " + ((j.error && j.error.message) || r.status));
    e.status = r.status;
    throw e;
  }
  return r;
}

const q = (s) => "'" + String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";

async function children(folderId, extra = "") {
  const out = [];
  let pageToken;
  do {
    const r = await gget("/files", {
      q: `${q(folderId)} in parents and trashed = false${extra}`,
      fields: "nextPageToken, files(id, name, mimeType, size, modifiedTime, parents)",
      pageSize: "100",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
      ...(pageToken ? { pageToken } : {}),
    });
    const j = await r.json();
    out.push(...(j.files || []));
    pageToken = j.nextPageToken;
  } while (pageToken);
  return out;
}

/** Files in Statements/<YYYY-MM>/, or null when that month's folder doesn't exist. */
export async function listMonth(month) {
  const folders = await children(STATEMENTS_FOLDER, " and mimeType = 'application/vnd.google-apps.folder'");
  const f = folders.find((x) => x.name.trim() === month);
  if (!f) return { folder: null, files: [], months: folders.map((x) => x.name).sort() };
  const files = (await children(f.id)).filter((x) => x.mimeType !== "application/vnd.google-apps.folder");
  return { folder: f.id, files, months: folders.map((x) => x.name).sort() };
}

/** Download one file — only if it sits in a month folder directly under Statements. */
export async function downloadStatement(fileId) {
  if (!/^[A-Za-z0-9_-]{10,100}$/.test(String(fileId || ""))) throw new Error("Bad Drive file id.");
  const meta = await (await gget("/files/" + fileId, { fields: "id, name, size, parents, mimeType", supportsAllDrives: "true" })).json();
  const parent = (meta.parents || [])[0];
  if (!parent) throw new Error("That Drive file isn't in the Statements folder.");
  const pm = await (await gget("/files/" + parent, { fields: "id, parents", supportsAllDrives: "true" })).json();
  if (!(pm.parents || []).includes(STATEMENTS_FOLDER)) throw new Error("That Drive file isn't in the Statements folder.");
  const r = await gget("/files/" + fileId, { alt: "media", supportsAllDrives: "true" });
  return { name: meta.name, bytes: Buffer.from(await r.arrayBuffer()) };
}

/* Guess which account a statement belongs to from its file name. Cards first,
 * because "HDFC" alone also matches the savings account. */
const GUESSES = [
  [/regalia|sid\s*cc|sidd0971/i, "hdfc_regalia"],
  [/money\s*back|solitaire|srp\s*cc|mom\s*cc|sary5172/i, "hdfc_solitaire"],
  [/sbi.*\bmn\b|\bmn\b.*sbi|manali/i, "sbi_mn"],
  [/sbi.*srp|srp.*sbi/i, "sbi_srp"],
  [/sbi.*sid|sid.*sbi/i, "sbi_sid"],
  [/\bbom\b|maharashtra/i, "bom"],
  [/\bubi\b|union/i, "ubi"],
  [/hdfc/i, "hdfc_bank"],
];
export function guessBank(name) {
  const n = String(name || "").replace(/\.[a-z]+$/i, "").replace(/[_-]+/g, " ");
  for (const [re, key] of GUESSES) if (re.test(n)) return key;
  return "";
}
