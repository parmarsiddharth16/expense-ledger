import React, { useState, useEffect } from "react";
import ReactDOM from "react-dom/client";
import ExpenseLedger, { auth, store } from "../ExpenseLedger.jsx";

/*
 * Access gate.
 *
 * The passcode is checked by the server (LEDGER_PASSCODE in the Vercel
 * project) and kept in memory only. Nothing is remembered between visits: every
 * new tab, reload or device asks again, and Log out — or a 401 from the API —
 * brings this screen straight back with the in-memory ledger dropped.
 */

const LEGACY_CODE = "2602";

function Gate() {
  const [ok, setOk] = useState(false);
  const [val, setVal] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [session, setSession] = useState(0); // remounts the app on each unlock

  useEffect(() => {
    const lock = (why) => () => {
      store.reset(); auth.set("");
      setOk(false); setVal(""); setErr(""); setMsg(why);
    };
    const onLogout = lock("You've been logged out.");
    const onExpired = lock("Please enter the passcode again.");
    const onReload = () => { store.reset(); setSession((n) => n + 1); };
    window.addEventListener("ledger:logout", onLogout);
    window.addEventListener("ledger:needs-passcode", onExpired);
    window.addEventListener("ledger:reload", onReload);
    return () => {
      window.removeEventListener("ledger:logout", onLogout);
      window.removeEventListener("ledger:needs-passcode", onExpired);
      window.removeEventListener("ledger:reload", onReload);
    };
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
        store.reset();
        setSession((n) => n + 1);
        setOk(true); setVal(""); setMsg(""); setBusy(false); return;
      }
      auth.set("");
      setErr(res.status === 401 ? "Incorrect code — try again." : "Couldn't reach the ledger. Try again.");
    } catch {
      auth.set("");
      setErr("Couldn't reach the ledger. Check your connection.");
    }
    setVal(""); setBusy(false);
  };

  if (ok) return <ExpenseLedger key={session} />;

  const wrap = {
    minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
    background: "#ECEFEE", fontFamily: "'Inter',system-ui,-apple-system,sans-serif",
    padding: 20, boxSizing: "border-box",
  };
  const card = {
    width: "100%", maxWidth: 360, background: "#fff", borderRadius: 18,
    border: "1px solid #E4E8EA", boxShadow: "0 10px 40px rgba(0,0,0,0.06)",
    padding: "34px 30px", textAlign: "center", boxSizing: "border-box",
  };
  const input = {
    width: "100%", boxSizing: "border-box", marginTop: 18, padding: "13px 14px",
    fontSize: 20, letterSpacing: "0.25em", textAlign: "center",
    borderRadius: 12, border: "1.5px solid " + (err ? "#C02942" : "#D5DBDE"),
    outline: "none", fontFamily: "inherit", background: "#F7F9F9",
  };
  const btn = {
    width: "100%", boxSizing: "border-box", marginTop: 14, padding: "13px 14px", minHeight: 46,
    fontSize: 15, fontWeight: 600, color: "#fff",
    background: busy ? "#6FA89E" : "#0E7C6B",
    border: "none", borderRadius: 12, cursor: busy ? "default" : "pointer", fontFamily: "inherit",
  };

  return (
    <div style={wrap}>
      <form style={card} onSubmit={submit}>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: "#171B1E", margin: "0 auto 12px", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
        </div>
        <div style={{ fontSize: 20, fontWeight: 700, color: "#171B1E", fontFamily: "'Space Grotesk','Inter',sans-serif" }}>Manali's Ledger</div>
        <div style={{ fontSize: 13, color: "#6B757D", marginTop: 6 }}>
          {msg || "Enter the passcode to continue"}
        </div>
        <label htmlFor="ledger-pass" style={{ position: "absolute", left: -9999 }}>Passcode</label>
        <input
          id="ledger-pass"
          style={input}
          type="password"
          autoComplete="current-password"
          autoFocus
          placeholder="Passcode"
          value={val}
          onChange={(e) => { setVal(e.target.value); if (err) setErr(""); }}
        />
        {err && <div role="alert" style={{ color: "#C02942", fontSize: 13, marginTop: 8 }}>{err}</div>}
        <button type="submit" style={btn} disabled={busy}>{busy ? "Checking…" : "Unlock"}</button>
        <div style={{ fontSize: 11.5, color: "#6B757D", marginTop: 14 }}>The passcode isn't remembered — you'll be asked each visit.</div>
      </form>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<Gate />);
