import crypto from "crypto";

/*
 * Passcode gate for the ledger API.
 *
 * Set LEDGER_PASSCODE in the Vercel project to turn it on. While it is unset the
 * API stays open exactly as it was, so deploying this can't lock anyone out of
 * their own ledger — but every response says protected:false so the app can put
 * a warning in front of you until it's set.
 */

export function isProtected() {
  return !!(process.env.LEDGER_PASSCODE && process.env.LEDGER_PASSCODE.length >= 4);
}

function safeEqual(a, b) {
  const A = Buffer.from(String(a));
  const B = Buffer.from(String(b));
  if (A.length !== B.length) {
    // still do a comparison so the timing doesn't leak the length
    crypto.timingSafeEqual(A, A);
    return false;
  }
  return crypto.timingSafeEqual(A, B);
}

function presented(req) {
  const h = req.headers || {};
  if (h["x-ledger-pass"]) return String(h["x-ledger-pass"]);
  const auth = h.authorization || "";
  if (/^Bearer /i.test(auth)) return auth.slice(7).trim();
  const cookie = h.cookie || "";
  const m = cookie.match(/(?:^|;\s*)ledger_pass=([^;]+)/);
  if (m) return decodeURIComponent(m[1]);
  return null;
}

/**
 * @returns {true} when the request may proceed. Otherwise responds 401 and
 * returns false — callers must stop.
 */
export function requirePasscode(req, res) {
  if (!isProtected()) {
    // On Vercel, a missing passcode is a misconfiguration, not an invitation:
    // fail closed so the ledger is never served to anyone who finds the URL.
    // (Only a local dev server, with no VERCEL_ENV, stays open.)
    if (process.env.VERCEL_ENV) {
      res.status(503).json({
        ok: false,
        locked: true,
        error: "The ledger is locked: LEDGER_PASSCODE isn't set for this deployment in Vercel. Set it, then redeploy.",
      });
      return false;
    }
    return true;
  }
  const given = presented(req);
  if (given && safeEqual(given, process.env.LEDGER_PASSCODE)) return true;
  res.status(401).json({
    ok: false,
    error: given ? "Wrong passcode." : "Passcode required.",
    needsPasscode: true,
  });
  return false;
}
