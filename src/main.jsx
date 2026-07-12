import React, { useState } from "react";
import ReactDOM from "react-dom/client";
import ExpenseLedger from "../ExpenseLedger.jsx";

/* Passcode gate: the dashboard is shown only after the access code is
   entered. Unlock is remembered for the browser tab session. */
const ACCESS_CODE = "2602";
const GATE_KEY = "ledger:gate";

function Gate() {
  const [ok, setOk] = useState(() => {
    try { return sessionStorage.getItem(GATE_KEY) === "ok"; } catch { return false; }
  });
  const [val, setVal] = useState("");
  const [err, setErr] = useState(false);

  if (ok) return <ExpenseLedger />;

  const submit = (e) => {
    if (e) e.preventDefault();
    if (val.trim() === ACCESS_CODE) {
      try { sessionStorage.setItem(GATE_KEY, "ok"); } catch {}
      setErr(false);
      setOk(true);
    } else {
      setErr(true);
      setVal("");
    }
  };

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
    fontSize: 15, fontWeight: 600, color: "#fff", background: "#0f766e",
    border: "none", borderRadius: 12, cursor: "pointer", fontFamily: "inherit",
  };

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
          onChange={(e) => { setVal(e.target.value); if (err) setErr(false); }}
          aria-label="Access code"
        />
        {err && (
          <div style={{ color: "#d9534f", fontSize: 12.5, marginTop: 8 }}>
            Incorrect code &mdash; try again.
          </div>
        )}
        <button type="submit" style={btn}>Unlock</button>
      </form>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<Gate />);
