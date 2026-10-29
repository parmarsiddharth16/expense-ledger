import React, { useMemo, useState } from "react";
import { Upload, X, Check, TriangleAlert, Info } from "lucide-react";
import { runAudit, makeStatementRecord, upsertStatement } from "./audit.js";

/* Paisa matter here — the rest of the app rounds to rupees, the audit can't. */
const fmt2 = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const rs = (n, sym = "₹") => (n == null ? "—" : `${n < 0 ? "−" : ""}${sym}${fmt2.format(Math.abs(n))}`);
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const mLabel = (m) => `${MON[+m.slice(5) - 1]} ${m.slice(2, 4)}`;
const fileToB64 = (f) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = () => rej(r.error); r.readAsDataURL(f); });

const STATUS = {
  ok:         { label: "Tallied",       cls: "ok" },
  explained:  { label: "Explained",     cls: "ex" },
  unverified: { label: "Unverified",    cls: "uv" },
  bad:        { label: "Not tallying",  cls: "bad" },
  missing:    { label: "Missing",       cls: "bad" },
};

/** Which account a statement file is, from its name. Only a first guess — the
 *  person confirms it before anything is read. */
function guessBank(name, banks) {
  const n = name.toLowerCase();
  const rules = [
    [/regalia|sid\s*cc|sid.*card/, "hdfc_regalia"], [/money\s*back|solitaire|srp\s*cc|mom.*card/, "hdfc_solitaire"],
    [/\bbom\b|maharashtra/, "bom"], [/\bubi\b|union/, "ubi"], [/hdfc/, "hdfc_bank"],
    [/manali|sbi\s*mn|\bmn\b/, "sbi_mn"], [/sbi\s*srp|\bsrp\b/, "sbi_srp"], [/sbi\s*sid|\bsid\b/, "sbi_sid"],
  ];
  const hit = rules.find(([re]) => re.test(n));
  return hit && banks.some((b) => b.key === hit[1]) ? hit[1] : "";
}

/**
 * The statement audit: an account × month grid of whether every statement
 * tallies, follows on from the last one, and agrees with the ledger.
 */
export function StatementAudit({ book = [], expenses = [], credits = [], banks = [], sym = "₹", notes = {}, api, onSaveBook, onEnterFigures }) {
  const [preview, setPreview] = useState(null);   // { records, reads } — back-check results not yet saved
  const [open, setOpen] = useState(null);          // { bank, month }
  const [checking, setChecking] = useState(false);

  const shownBook = useMemo(() => (preview ? preview.records.reduce(upsertStatement, book) : book), [book, preview]);
  const audit = useMemo(() => runAudit(shownBook, { expenses, credits }, banks, { notes }), [shownBook, expenses, credits, banks, notes]);
  const bankRows = banks.filter((b) => audit.cells[b.key]);
  const counts = useMemo(() => {
    const c = { ok: 0, explained: 0, unverified: 0, bad: 0 };
    Object.values(audit.cells).forEach((row) => Object.values(row).forEach((x) => { c[x.status === "missing" ? "bad" : x.status] = (c[x.status === "missing" ? "bad" : x.status] || 0) + 1; }));
    return c;
  }, [audit]);
  const cell = open ? audit.cells[open.bank]?.[open.month] : null;

  return (
    <section className="panel sa">
      <div className="panel-head">
        <h2>Statement audit</h2>
        <button className="btn-ghost sm" onClick={() => setChecking((v) => !v)}><Upload size={14} /> Check past statements</button>
      </div>
      <p className="sa-lede">
        Each statement is checked to the paisa: opening + money in − money out = closing, the opening matches last month's closing,
        and every line is in the ledger. Red means something doesn't tally — tap it to see why.
      </p>

      {checking && <BackCheck banks={banks} api={api} onDone={(p) => { setPreview(p); setChecking(false); }} onCancel={() => setChecking(false)} />}

      {preview && (
        <div className="sa-preview">
          <Info size={15} />
          <span><strong>Preview — not saved.</strong> {preview.records.length} statement{preview.records.length === 1 ? "" : "s"} read
            {preview.reads.some((r) => !r.ok) ? `, ${preview.reads.filter((r) => !r.ok).length} couldn't be read` : ""}. The grid below includes them.</span>
          <span className="sa-preview-btns">
            <button className="btn-ghost sm" onClick={() => setPreview(null)}>Discard</button>
            <button className="btn-primary sm" onClick={() => { onSaveBook(preview.records.reduce(upsertStatement, book), preview.records); setPreview(null); }}>Save to audit</button>
          </span>
          {preview.reads.filter((r) => !r.ok).map((r) => <div key={r.file} className="sa-readfail">{r.file}: {r.why}</div>)}
        </div>
      )}

      {!audit.months.length ? (
        <div className="empty">No statements in the audit yet. They're added automatically from the next import — or use “Check past statements”.</div>
      ) : (<>
        <div className="sa-legend">
          {[["ok", counts.ok], ["explained", counts.explained], ["unverified", counts.unverified], ["bad", counts.bad]].map(([k, n]) => (
            <span key={k} className={"sa-key sa-" + STATUS[k].cls}><i /> {STATUS[k].label} <b className="num">{n}</b></span>
          ))}
        </div>
        <div className="sa-gridwrap">
          <table className="sa-grid">
            <thead><tr><th>Account</th>{audit.months.map((m) => <th key={m}>{mLabel(m)}</th>)}</tr></thead>
            <tbody>
              {bankRows.map((b) => (
                <tr key={b.key}>
                  <th>{b.label}</th>
                  {audit.months.map((m) => {
                    const c = audit.cells[b.key][m];
                    if (!c) return <td key={m}><span className="sa-cell sa-none">·</span></td>;
                    const s = STATUS[c.status];
                    const isOpen = open && open.bank === b.key && open.month === m;
                    return (
                      <td key={m}>
                        <button className={`sa-cell sa-${s.cls}${isOpen ? " on" : ""}`} title={s.label} onClick={() => setOpen(isOpen ? null : { bank: b.key, month: m })}>
                          {c.status === "ok" ? <Check size={14} strokeWidth={2.6} /> : c.status === "unverified" ? "?" : c.status === "missing" ? "—" : c.status === "explained" ? "✓" : <span className="num">{c.gap ? short(c.gap) : "!"}</span>}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>)}

      {cell && (
        <CellDetail cell={cell} bank={banks.find((b) => b.key === open.bank)} audit={audit} sym={sym}
          onEnterFigures={onEnterFigures} isPreview={(id) => !!preview?.records.some((r) => r.id === id)} onClose={() => setOpen(null)} />
      )}
    </section>
  );
}

const short = (n) => (n >= 1e5 ? (n / 1e5).toFixed(1) + "L" : n >= 1e3 ? (n / 1e3).toFixed(1) + "k" : String(Math.round(n)));

function CellDetail({ cell, bank, audit, sym, onEnterFigures, isPreview, onClose }) {
  return (
    <div className="sa-detail">
      <div className="sa-detail-head">
        <strong>{bank?.label} · {mLabel(cell.month)}</strong>
        <span className={"sa-pill sa-" + STATUS[cell.status].cls}>{STATUS[cell.status].label}{cell.gap ? ` · ${rs(cell.gap, sym)} unexplained` : ""}</span>
        <button className="icon-btn" aria-label="Close" onClick={onClose}><X size={15} /></button>
      </div>
      {!cell.ids.length && <div className="sa-find bad"><TriangleAlert size={14} /> No statement covers this month. Upload it to complete the audit.</div>}
      {cell.ids.map((id) => {
        const d = audit.statements[id]; if (!d) return null;
        const st = d.statement;
        const seg = d.months.find((x) => x.month === cell.month);
        const fs = [...d.findings, ...(seg?.findings || [])].filter((f) => f.level !== "info" || f.code === "first" || f.code === "overlap");
        return (
          <div key={id} className="sa-stmt">
            <div className="sa-stmt-file">{st.file || "statement"} · {st.from} to {st.to}{isPreview(id) ? " · preview" : ""}</div>
            <div className="sa-sum num">
              <div><span>Opening</span>{rs(seg && !seg.whole ? seg.opening : st.opening, sym)}<em>{seg && !seg.whole ? "this month" : st.openingSrc || "not read"}</em></div>
              <div><span>{st.mode === "card" ? "Purchases" : "Money in"}</span>{st.mode === "card" ? "+" + rs(seg ? seg.dr : d.movement.dr, sym) : "+" + rs(seg ? seg.cr : d.movement.cr, sym)}</div>
              <div><span>{st.mode === "card" ? "Payments" : "Money out"}</span>{st.mode === "card" ? "−" + rs(seg ? seg.cr : d.movement.cr, sym) : "−" + rs(seg ? seg.dr : d.movement.dr, sym)}</div>
              <div><span>Closing</span>{rs(seg && !seg.whole ? seg.closing : st.closing, sym)}<em>{seg && !seg.whole ? "this month" : st.closingSrc || "not read"}</em></div>
            </div>
            {!fs.length && <div className="sa-find ok"><Check size={14} /> Tallies, follows on from the last statement, and every line matches the ledger.</div>}
            {fs.map((f, i) => (
              <div key={f.id + i} className={"sa-find " + (f.level === "bad" ? "bad" : f.level === "unverified" ? "uv" : f.level === "explained" ? "ex" : "info")}>
                {f.level === "bad" ? <TriangleAlert size={14} /> : <Info size={14} />}
                <span>{f.text}{f.note ? <em> — {f.note}</em> : null}</span>
              </div>
            ))}
            {(st.opening == null || st.closing == null || st.openingSrc === "entered" || st.closingSrc === "entered") && !isPreview(id) && (
              <EnterFigures st={st} onSave={(v) => onEnterFigures(st.id, v)} />
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Type the opening/closing from the paper statement when it couldn't be read.
 *  Recorded as "entered", and logged, so it is never mistaken for a read figure. */
function EnterFigures({ st, onSave }) {
  const [o, setO] = useState(st.opening ?? "");
  const [c, setC] = useState(st.closing ?? "");
  const n = (v) => (v === "" || v == null ? null : parseFloat(String(v).replace(/,/g, "")));
  return (
    <div className="sa-enter">
      <label>Opening<input className="num" inputMode="decimal" value={o} onChange={(e) => setO(e.target.value)} placeholder="from the statement" /></label>
      <label>{st.mode === "card" ? "Total due" : "Closing"}<input className="num" inputMode="decimal" value={c} onChange={(e) => setC(e.target.value)} placeholder="from the statement" /></label>
      <button className="btn-ghost sm" disabled={n(o) == null && n(c) == null} onClick={() => onSave({ opening: n(o), closing: n(c) })}>Save figures</button>
    </div>
  );
}

/** Read past statements for the audit only — nothing is imported into the
 *  ledger, and nothing is saved until "Save to audit" is pressed. */
function BackCheck({ banks, api, onDone, onCancel }) {
  const [files, setFiles] = useState([]);   // { file, bank }
  const [pwd, setPwd] = useState("");
  const [busy, setBusy] = useState("");
  const pick = (e) => {
    const list = [...(e.target.files || [])].map((f) => ({ file: f, bank: guessBank(f.name, banks) }));
    setFiles((prev) => [...prev, ...list]);
    e.target.value = "";
  };
  const run = async () => {
    const records = [], reads = [];
    for (let i = 0; i < files.length; i++) {
      const { file, bank } = files[i];
      setBusy(`Reading ${i + 1} of ${files.length}: ${file.name}`);
      try {
        const ex = await api("/api/extract", { method: "POST", body: JSON.stringify({ file: await fileToB64(file), password: pwd, bank, filename: file.name, yearHint: new Date().getFullYear() }) });
        const src = ex.diagnostics?.source || "";
        if (!(ex.transactions || []).length) { reads.push({ file: file.name, ok: false, why: src === "no-text-layer" ? "no readable text (re-save it with “Save as PDF”, not “Microsoft Print to PDF”)" : "no transactions found" }); continue; }
        if (src === "claude") { reads.push({ file: file.name, ok: false, why: "only readable by AI, which can't be audited to the paisa — use the bank's original PDF" }); continue; }
        records.push(makeStatementRecord({
          id: "st_" + bank + "_" + Date.now().toString(36) + i, bank, mode: banks.find((b) => b.key === bank)?.mode, file: file.name, via: "back-check",
          transactions: ex.transactions, figures: { ...(ex.figures || {}), amountDue: ex.summary?.amountDue }, diagnostics: ex.diagnostics,
        }));
        reads.push({ file: file.name, ok: true });
      } catch (e) {
        reads.push({ file: file.name, ok: false, why: String(e.message || e) });
      }
    }
    setBusy("");
    onDone({ records, reads });
  };
  return (
    <div className="sa-back">
      <div className="sa-back-row">
        <label className="btn-ghost sm"><Upload size={14} /> Choose statement PDFs<input type="file" accept=".pdf,.csv,.xls,.xlsx" multiple hidden onChange={pick} /></label>
        <input className="sa-pwd" type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} placeholder="Password (optional — saved ones are tried)" autoComplete="off" />
      </div>
      {files.map((f, i) => (
        <div key={i} className="sa-back-file">
          <span>{f.file.name}</span>
          <select value={f.bank} onChange={(e) => setFiles(files.map((x, j) => (j === i ? { ...x, bank: e.target.value } : x)))}>
            <option value="">Which account?</option>
            {banks.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
          </select>
          <button className="icon-btn" aria-label="Remove" onClick={() => setFiles(files.filter((_, j) => j !== i))}><X size={14} /></button>
        </div>
      ))}
      <div className="sa-back-row">
        <button className="btn-ghost sm" onClick={onCancel}>Cancel</button>
        <button className="btn-primary sm" disabled={!files.length || files.some((f) => !f.bank) || !!busy} onClick={run}>{busy || `Check ${files.length || ""} statement${files.length === 1 ? "" : "s"}`}</button>
      </div>
      <div className="sa-note">Statements are only read and compared. Nothing is added to the ledger.</div>
    </div>
  );
}

export const auditCss = `
.sa-lede{font-size:12.5px; color:var(--muted); margin:-4px 0 12px; line-height:1.5;}
.sa-legend{display:flex; gap:14px; flex-wrap:wrap; font-size:12px; color:var(--muted); margin-bottom:8px;}
.sa-key{display:inline-flex; align-items:center; gap:6px;}
.sa-key i{width:10px; height:10px; border-radius:3px; display:inline-block; background:var(--c);}
.sa-key b{color:var(--ink); font-weight:600;}
.sa-ok{--c:var(--teal); --s:var(--teal-soft);}
.sa-ex{--c:var(--amber); --s:#FBEBD6;}
.sa-uv{--c:var(--muted); --s:#EEF0F1;}
.sa-bad{--c:var(--red); --s:var(--red-soft);}
.sa-gridwrap{overflow-x:auto; -webkit-overflow-scrolling:touch; border:1px solid var(--hairline); border-radius:12px;}
.sa-grid{border-collapse:collapse; width:100%; font-size:12.5px;}
.sa-grid th, .sa-grid td{padding:6px 6px; text-align:center; border-bottom:1px solid var(--hairline); white-space:nowrap;}
.sa-grid thead th{font-weight:600; color:var(--muted); font-size:11.5px;}
.sa-grid tbody th{text-align:left; font-weight:600; position:sticky; left:0; background:var(--surface); padding-left:10px; z-index:1;}
.sa-grid tr:last-child th, .sa-grid tr:last-child td{border-bottom:0;}
.sa-cell{min-width:44px; height:30px; border-radius:8px; border:1.5px solid transparent; background:var(--s); color:var(--c); font-weight:700; font-size:11.5px; display:inline-grid; place-items:center; cursor:pointer; padding:0 6px; font-family:inherit;}
.sa-cell.on{border-color:var(--c);}
.sa-none{background:transparent; color:var(--faint); cursor:default;}
.sa-pill{display:inline-block; border-radius:999px; padding:2px 9px; font-size:11.5px; font-weight:600; background:var(--s); color:var(--c);}
.sa-detail{margin-top:12px; border:1px solid var(--hairline); border-radius:12px; padding:12px; background:var(--surface);}
.sa-detail-head{display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:8px;}
.sa-detail-head .icon-btn{margin-left:auto;}
.sa-stmt{border-top:1px solid var(--hairline); padding-top:10px; margin-top:10px;}
.sa-stmt:first-of-type{border-top:0; margin-top:0;}
.sa-stmt-file{font-size:12px; color:var(--muted); margin-bottom:8px; word-break:break-word;}
.sa-sum{display:grid; grid-template-columns:repeat(4,1fr); gap:8px; margin-bottom:8px;}
.sa-sum div{background:var(--bg); border-radius:9px; padding:8px 10px; font-size:13px; display:flex; flex-direction:column; gap:2px;}
.sa-sum span{font-family:'Inter',sans-serif; font-size:11px; color:var(--muted); letter-spacing:0;}
.sa-sum em{font-family:'Inter',sans-serif; font-style:normal; font-size:10.5px; color:var(--faint); letter-spacing:0;}
.sa-find{display:flex; gap:8px; align-items:flex-start; font-size:12.5px; line-height:1.45; padding:6px 8px; border-radius:8px; margin-top:4px;}
.sa-find svg{flex-shrink:0; margin-top:2px;}
.sa-find.bad{background:var(--red-soft); color:#8A1C2F;}
.sa-find.ok{background:var(--teal-soft); color:var(--teal);}
.sa-find.ex{background:#FBEBD6; color:#7A3A06;}
.sa-find.uv{background:#EEF0F1; color:var(--ink);}
.sa-find.info{color:var(--muted);}
.sa-enter{display:flex; gap:8px; flex-wrap:wrap; align-items:flex-end; margin-top:10px;}
.sa-enter label{display:flex; flex-direction:column; gap:3px; font-size:11.5px; color:var(--muted);}
.sa-enter input{border:1px solid var(--hairline); border-radius:8px; padding:7px 9px; font-size:13px; width:150px;}
.sa-preview{display:flex; flex-wrap:wrap; gap:8px; align-items:center; background:#FBEBD6; color:#7A3A06; border-radius:10px; padding:10px 12px; font-size:12.5px; margin-bottom:12px;}
.sa-preview-btns{margin-left:auto; display:flex; gap:6px;}
.sa-readfail{flex-basis:100%; font-size:12px;}
.sa-back{border:1px dashed var(--hairline); border-radius:12px; padding:12px; margin-bottom:12px; display:flex; flex-direction:column; gap:8px;}
.sa-back-row{display:flex; gap:8px; flex-wrap:wrap; align-items:center;}
.sa-back-row:last-of-type{justify-content:flex-end;}
.sa-pwd{flex:1; min-width:180px; border:1px solid var(--hairline); border-radius:9px; padding:8px 10px; font-size:13px;}
.sa-back-file{display:grid; grid-template-columns:1fr auto auto; gap:8px; align-items:center; font-size:12.5px;}
.sa-back-file span{overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
.sa-back-file select{border:1px solid var(--hairline); border-radius:8px; padding:6px 8px; font-size:12.5px; max-width:180px;}
.sa-note{font-size:11.5px; color:var(--muted);}
.btn-primary{display:inline-flex; align-items:center; gap:7px; background:var(--ink); color:#fff; border:1px solid var(--ink); border-radius:11px; padding:9px 13px; font-size:13px; font-weight:600; cursor:pointer; font-family:inherit;}
.btn-primary:disabled{opacity:.45; cursor:default;}
.btn-primary.sm, .btn-ghost.sm{padding:6px 10px; font-size:12.5px;}
@media (max-width:640px){
  .sa-sum{grid-template-columns:repeat(2,1fr);}
  .sa-back-file{grid-template-columns:1fr auto;}
  .sa-back-file select{grid-column:1 / 2; max-width:none;}
}
`;
