import React, { useState, useEffect } from "react";
import ReactDOM from "react-dom/client";
import ExpenseLedger, { auth } from "../ExpenseLedger.jsx";

/*
 * Access gate.
 *
 * This used to compare what you typed against a constant sitting in this file.
 * That constant shipped inside the JavaScript bundle, so it was readable by
 * anyone who opened the page — and it protected nothing anyway, because
 * /api/data answered any request that reached it. The ledger was effectively
 * public to anyone who knew the URL.
 *
 * Now the code is checked by the server: it is sent as the passcode header on a
 * real request, and the ledger renders only if that request is accepted. The
 * passcode itself lives in LEDGER_PASSCODE in the Vercel project and never
 * ships to the browser.
 *
 * Until that variable is set the server accepts everything, so the old local
 * code still opens the app rather than locking anyone out — but the app then
 * shows a standing warning that the ledger is unprotected.
 */

const LEGACY_CODE = "2602";
const GATE_KEY = "ledger:gate";

function Gate() {
  const [ok, setOk] = useState(false);
  const [checking, setChecking] = useState(true);
  const [val, setVal] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  // A remembered passcode is re-verified on load, so revoking it on the server
  // actually locks the app rather than leaving old sessions open.
  useEffect(() => {
    (async () => {
      try {
        if (sessionStorage.getItem(GATE_KEY) === "ok" || auth.pass) {
          const res = await fetch("/api/data", { cache: "no-store", headers: auth.headers() });
          if (res.ok) { setOk(true); setChecking(false); return; }
          try { sessionStorage.removeItem(GATE_KEY); } catch {}
          auth.set("");
        }
      } catch {
        // offline: fall through to the prompt, the app works from its local cache
      }
      setChecking(false);
    })();
  }, []);

  const submit = async (e) => {
    if (e) e.preventDefault();
    const code = val.trim();
    if (!code) return;
    setBusy(true); setErr("");
    auth.set(code);
    try {
      const res = await fetch("/api/data", { cache: "no-store", headers: auth.headers() });
      if (res.ok) {
        const json = await res.json().catch(() => ({}));
        // server has no passcode configured — accept only the legacy code, and
        // keep it out of the auth header so nothing pretends this is protected
        if (json && json.protected === false && code !== LEGACY_CODE) {
          auth.set(""); setErr("Incorrect code — try again."); setVal(""); setBusy(false); return;
        }
        if (json && json.protected === false) auth.set("");
        try { sessionStorage.setItem(GATE_KEY, "ok"); } catch {}
        setOk(true); setBusy(false); return;
      }
      auth.set("");
      setErr(res.status === 401 ? "Incorrect code — try again." : "Couldn't reach the ledger. Try again.");
    } catch {
      auth.set("");
      setErr("Couldn't reach the ledger. Check your connection.");
    }
    setVal(""); setBusy(false);
  };

  if (ok) return <ExpenseLedger />;

  const wrap = {
    minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
    background: "#f6f5f1", fontFamily: "'Inter',system-ui,-apple-system,sans-serif",
    padding: 20, boxSizing: "border-box",
  };
  const card = {
    width: "100%", maxWidth: 340, background: "#fff", borderRadius: 18,
    border: "1px solid #e7e4dd", boxShadow: "0 10px 40px rgba(0,0,0,0.06)",
    padding: "34px 30px", textAlign: "center", boxSizing: "border-box",
  };
  const input = {
    width: "100%", boxSizing: "border-box", marginTop: 18, padding: "13px 14px",
    fontSize: 22, letterSpacing: "0.4em", textAlign: "center",
    borderRadius: 12, border: "1.5px solid " + (err ? "#d9534f" : "#dcd8cf"),
    outline: "none", fontFamily: "inherit", background: "#fbfaf7",
  };
  const btn = {
    width: "100%", boxSizing: "border-box", marginTop: 14, padding: "12px 14px",
    fontSize: 15, fontWeight: 600, color: "#fff",
    background: busy ? "#7fb3ad" : "#0f766e",
    border: "none", borderRadius: 12, cursor: busy ? "default" : "pointer", fontFamily: "inherit",
  };

  if (checking) {
    return <div style={wrap}><div style={{ ...card, color: "#8a857c", fontSize: 14 }}>Checking…</div></div>;
  }

  return (
    <div style={wrap}>
      <form style={card} onSubmit={submit}>
        <div style={{ fontSize: 30, marginBottom: 6 }}>&#128274;</div>
        <div style={{ fontSize: 19, fontWeight: 700, color: "#1c1b18",
          fontFamily: "'Space Grotesk','Inter',sans-serif" }}>Manali's Ledger</div>
        <div style={{ fontSize: 13, color: "#8a857c", marginTop: 6 }}>
          Enter the access code to continue
        </div>
        <input
          style={input}
          type="password"
          inputMode="numeric"
          autoFocus
          placeholder="&#8226;&#8226;&#8226;&#8226;"
          value={val}
          onChange={(e) => { setVal(e.target.value); if (err) setErr(""); }}
          aria-label="Access code"
        />
        {err && (
          <div style={{ color: "#d9534f", fontSize: 12.5, marginTop: 8 }}>{err}</div>
        )}
        <button type="submit" style={btn} disabled={busy}>{busy ? "Checking…" : "Unlock"}</button>
      </form>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<Gate />);
