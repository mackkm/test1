/* Minimal Anthropic Messages API client (zero-dep). The autopilot uses Claude
 * for campaign research synthesis and shorts scriptwriting. */

"use strict";

const { requestJSON } = require("./http");

const API_KEY = process.env.ANTHROPIC_API_KEY || "";
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
const BASE = process.env.ANTHROPIC_API_URL || "https://api.anthropic.com";

async function ask(system, user, { maxTokens = 2000 } = {}) {
  if (!API_KEY) throw new Error("ANTHROPIC_API_KEY is not set");
  const res = await requestJSON(`${BASE}/v1/messages`, {
    method: "POST",
    headers: {
      "x-api-key": API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: {
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    },
    timeoutMs: 120000,
  });
  const text = (res.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  if (!text) throw new Error(`empty Claude response: ${JSON.stringify(res).slice(0, 300)}`);
  return text;
}

/* Ask for strict JSON; tolerates markdown fences; one retry with the parse
 * error fed back so the model can correct itself. */
async function askJSON(system, user, opts = {}) {
  const sys = `${system}\n\nRespond with a single valid JSON object and nothing else.`;
  let text = await ask(sys, user, opts);
  for (let attempt = 0; ; attempt++) {
    const parsed = extractJSON(text);
    if (parsed !== undefined) return parsed;
    if (attempt >= 1) throw new Error(`Claude did not return valid JSON: ${text.slice(0, 300)}`);
    text = await ask(sys, `${user}\n\nYour previous reply was not valid JSON. Reply again with only the JSON object.`, opts);
  }
}

function extractJSON(text) {
  const stripped = text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start === -1 || end <= start) return undefined;
  try {
    return JSON.parse(stripped.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

module.exports = { ask, askJSON, MODEL };
