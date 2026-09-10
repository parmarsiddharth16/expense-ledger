/*
 * Server-side Claude call. The API key lives in the Vercel environment and
 * never reaches the browser — the version of this that shipped in the app made
 * this request from the client, which could only ever have worked by exposing
 * the key to anyone who opened the page.
 */

export function hasKey() {
  return !!process.env.ANTHROPIC_API_KEY;
}

export async function askClaude({ content, maxTokens = 2000, system, model }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set on the server.");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: model || process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
      max_tokens: maxTokens,
      ...(system ? { system } : {}),
      messages: [{ role: "user", content }],
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Claude API ${res.status}: ${detail.slice(0, 300)}`);
  }
  const json = await res.json();
  return (json.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
}
