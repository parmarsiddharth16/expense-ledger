import { requirePasscode } from "./_lib/auth.js";
import { resolveToken, readLedger, readJsonBody } from "./_lib/blob.js";
import { askClaude, hasKey } from "./_lib/ai.js";

/*
 * POST /api/ask { question, monthStart?, today? } -> { ok, answer }
 *
 * Answers a plain-English question about the household ledger. The ledger is
 * read on the server and condensed — category list with budgets, every
 * expense of the last 12 months as one compact line, money-in by kind,
 * goals and latest balances — and Claude answers from that alone. The data
 * goes to the Anthropic API under the same key the categoriser already uses.
 */

const SYSTEM = `You answer questions about one Indian household's expense ledger ("Manali's Ledger").
Use ONLY the data provided. If the data can't answer the question, say exactly what is missing (for example: "no statements imported for September yet").
Be concise: lead with the direct answer, then at most a few short supporting lines or a small list. Show money as ₹ with Indian digit grouping (₹1,23,456). Do the arithmetic carefully; when you total or average, say over which months.
Categories in the section "Claims & Transfers" are not household spend — leave them out of spend totals unless asked. Refund lines (negative amounts) reduce spend in their category.
Income means only credits of kind salary, rent, interest or other_income.
Never give investment or tax advice; you may describe what the numbers show.`;

const r = (n) => Math.round(n || 0);

function periodOf(date, start) {
  if (!start || start === 1) return date.slice(0, 7);
  const [y, m, d] = date.split("-").map(Number);
  if (d >= start) return date.slice(0, 7);
  const p = new Date(y, m - 2, 1);
  return `${p.getFullYear()}-${String(p.getMonth() + 1).padStart(2, "0")}`;
}

export function buildContext(data, { monthStart = 1, today }) {
  const cats = data["ledger:categories"] || [];
  const byId = Object.fromEntries(cats.map((c) => [c.id, c]));
  const exps = data["ledger:expenses"] || [];
  const credits = data["ledger:credits"] || [];
  const now = today || new Date().toISOString().slice(0, 10);
  const since = new Date(Date.parse(now) - 372 * 864e5).toISOString().slice(0, 10);

  const lines = [];
  lines.push(`Today: ${now}. Ledger months ${monthStart === 1 ? "are calendar months" : `start on day ${monthStart} (a month "YYYY-MM" runs from day ${monthStart} of that month)`}.`);
  lines.push("", "## Categories (section | name | budget for each calendar month Jan..Dec of the current financial year | due day)");
  for (const c of cats) lines.push(`${c.section} | ${c.name} | ${(c.monthly || []).map(r).join(",")}${c.dueDay ? ` | due ${c.dueDay}` : ""}`);

  lines.push("", "## Expenses, last 12 months (ledger month | date | amount | category | note | account | people | tags)");
  const rows = exps.filter((e) => e.date >= since).sort((a, b) => a.date.localeCompare(b.date));
  for (const e of rows.slice(-2500)) {
    const cat = byId[e.cat]?.name || (e.cat === "__suspense__" ? "Suspense(uncategorised)" : "Uncategorised");
    lines.push(`${periodOf(e.date, monthStart)} | ${e.date} | ${r(e.amount)} | ${cat} | ${String(e.note || "").slice(0, 50)} | ${e.bank || ""} | ${e.person || ""} | ${(e.tags || []).join(" ")}`);
  }
  for (const c of credits.filter((c) => c.kind === "refund" && c.cat && c.date >= since)) {
    lines.push(`${periodOf(c.date, monthStart)} | ${c.date} | -${r(c.amount)} | ${byId[c.cat]?.name || "?"} | REFUND ${String(c.note || "").slice(0, 40)} | ${c.bank || ""} |  | `);
  }

  lines.push("", "## Money in (ledger month | date | amount | kind | note | account)");
  for (const c of credits.filter((c) => c.date >= since).sort((a, b) => a.date.localeCompare(b.date))) {
    lines.push(`${periodOf(c.date, monthStart)} | ${c.date} | ${r(c.amount)} | ${c.kind} | ${c.remark ? c.remark + " · " : ""}${String(c.note || "").slice(0, 50)} | ${c.bank || ""}`);
  }

  const goals = data["ledger:goals"] || [];
  if (goals.length) {
    lines.push("", "## Savings goals (name | target | saved | target month)");
    for (const g of goals) lines.push(`${g.name} | ${r(g.target)} | ${r((g.log || []).reduce((s, x) => s + x.amount, 0))} | ${g.by || ""}`);
  }
  const bal = data["ledger:balances"] || {};
  const bl = Object.entries(bal).map(([bank, list]) => [bank, (list || [])[0]]).filter(([, x]) => x);
  if (bl.length) {
    lines.push("", "## Latest statement figures (account | as of | balance | card amount due | min due | due date)");
    for (const [bank, x] of bl) lines.push(`${bank} | ${x.asOf || ""} | ${x.balance ?? ""} | ${x.amountDue ?? ""} | ${x.minDue ?? ""} | ${x.dueDate ?? ""}`);
  }
  return lines.join("\n");
}

export default async function handler(req, res) {
  if (!requirePasscode(req, res)) return;
  if (req.method !== "POST") { res.status(405).json({ ok: false, error: "Method not allowed" }); return; }
  if (!hasKey()) { res.status(501).json({ ok: false, error: "Ask needs ANTHROPIC_API_KEY to be set for this deployment in Vercel." }); return; }
  try {
    const body = await readJsonBody(req);
    const question = String(body.question || "").trim().slice(0, 1000);
    if (!question) { res.status(400).json({ ok: false, error: "Ask a question first." }); return; }
    const token = resolveToken();
    const data = await readLedger(token);
    const context = buildContext(data, { monthStart: Number(body.monthStart) || 1, today: body.today });
    const history = Array.isArray(body.history) ? body.history.slice(-4) : [];
    const prior = history.map((h) => `Earlier question: ${String(h.q).slice(0, 300)}\nYour earlier answer: ${String(h.a).slice(0, 1200)}`).join("\n\n");
    const answer = await askClaude({
      system: SYSTEM,
      maxTokens: 1200,
      content: [{ type: "text", text: `<ledger>\n${context}\n</ledger>\n\n${prior ? prior + "\n\n" : ""}Question: ${question}` }],
    });
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ ok: true, answer: answer.trim() });
  } catch (e) {
    res.status(500).json({ ok: false, error: String((e && e.message) || e) });
  }
}
