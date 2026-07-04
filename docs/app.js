/* PocketClaw — a pocket OpenClaw-style assistant powered by Claude.
 * Pure client-side: your API key lives only in this browser's localStorage
 * and requests go straight from your phone to api.anthropic.com. */

"use strict";

const API_BASE = "https://api.anthropic.com";
const API_VERSION = "2023-06-01";

const DEFAULT_PERSONA =
  "You are PocketClaw, a sharp, friendly personal assistant living on the user's phone. " +
  "Be concise by default — this is a mobile chat. Be direct, warm, and genuinely useful. " +
  "Use markdown when it helps readability.";

// Fallback list used until the live /v1/models fetch succeeds.
const FALLBACK_MODELS = [
  { id: "claude-opus-4-8", label: "Claude Opus 4.8 (recommended)" },
  { id: "claude-fable-5", label: "Claude Fable 5 (most capable)" },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5 (fastest)" },
];

// Models that accept adaptive thinking + effort. Older/smaller models get
// a plain request with no thinking/output_config fields.
const ADAPTIVE_RE = /fable-5|mythos-5|opus-4-[678]|sonnet-5|sonnet-4-6/;

/* ---------- state ---------- */

const state = {
  settings: {
    backend: "api",       // "api" (direct, key) | "cli" (Claude Code via gateway)
    apiKey: "",
    model: "claude-opus-4-8",
    persona: DEFAULT_PERSONA,
    thinking: true,
    webSearch: true,
    firecrawl: false,
    firecrawlKey: "",
    effort: "",
    maxTokens: 8192,
    gatewayUrl: "",       // empty = same origin as the app
    gatewayToken: "",
    // CLI-mode MCP superpowers, forwarded to the gateway (in memory only)
    cliTandem: false,
    cliTandemUrl: "",
    cliTandemToken: "",
    cliFirecrawl: false,
    cliFirecrawlKey: "",
  },
  convos: [],          // [{id, title, messages:[{role, content, images?}], updated}]
  currentId: null,
  streaming: false,
  abort: null,
  pendingImages: [],   // [{media_type, data}] queued for the next message
  loops: [],           // [{id, name, prompt, every, enabled, convoId, lastRunAt, syncedUpTo}]
  skills: [],          // [{id, name, instructions, enabled}]
  memory: [],          // ["fact", ...] — self-learned notes about the user
  loopBusy: false,
  gatewayTandem: false,     // gateway has a Tandem Browser connected
  gatewayFirecrawl: false,  // gateway has Firecrawl tools enabled
  overdrive: false,         // one-tap maximum-intelligence mode
  preOverdrive: null,       // settings snapshot to restore when it's turned off
};

// The smartest configuration PocketClaw can run.
const OVERDRIVE = {
  model: "claude-fable-5",  // most capable model
  effort: "max",
  thinking: true,
  webSearch: true,
  firecrawl: true,
  maxTokens: 32000,
};

// Prompt library — 4 random chips are shown on the welcome screen; "More ideas"
// reshuffles.
const SUGGESTIONS = {
  api: [
    ["🗞️", "What's happening in the news today?"],
    ["✍️", "Help me draft a tricky message"],
    ["💡", "Brainstorm ideas with me"],
    ["🧠", "Teach me something surprising"],
    ["🌍", "Plan a weekend trip within 3 hours of me — ask me where I live first"],
    ["🍝", "Suggest dinner from ingredients I'll list"],
    ["📷", "I'll send a photo — tell me what it is"],
    ["🏋️", "Build me a 20-minute no-equipment workout"],
    ["📈", "How are the markets doing right now?"],
    ["🎬", "Recommend a movie based on three I love"],
    ["🗣️", "Help me practice a difficult conversation"],
    ["🧾", "I'll photograph a receipt — split it 3 ways"],
    ["📖", "Summarize a famous book in 5 bullet points"],
    ["🎁", "Gift ideas for someone who has everything"],
    ["🧮", "Explain a concept like I'm five"],
    ["🌐", "Translate something and explain the nuances"],
  ],
  cli: [
    ["📁", "Give me a quick tour of this workspace"],
    ["🐛", "Scan the code for potential bugs"],
    ["📜", "Summarize the recent git history"],
    ["🔧", "Help me build something new here"],
    ["🧪", "Write tests for the least-tested file"],
    ["📝", "Update the README to match the current code"],
    ["🔍", "Find all TODO and FIXME comments and rank them"],
    ["🏗️", "Explain the architecture of this project"],
    ["🧹", "Find dead code we could delete"],
    ["🛡️", "Review the code for security issues"],
    ["⚡", "Find the slowest part of this code and speed it up"],
    ["📦", "Are any dependencies outdated or risky?"],
    ["🎨", "Suggest three UX improvements and implement one"],
    ["🚀", "What should we build next? Look around and pitch me"],
  ],
  // shown only when the gateway reports a connected Tandem Browser
  tandem: [
    ["🌐", "Open the browser, check today's top stories, and summarize"],
    ["🛒", "Look up a product in the browser and tell me the best price"],
    ["📸", "Take a screenshot of a website and describe what you see"],
    ["🗂️", "Look through my open tabs and summarize what I was researching"],
  ],
  // shown when Firecrawl web tools are enabled
  firecrawl: [
    ["🔥", "Scrape a webpage I give you and summarize it"],
    ["🕸️", "Research a topic across several sites and write me a brief"],
    ["🏷️", "Compare prices for a product across a few stores"],
    ["🧭", "Map out all the pages on a website I name"],
  ],
};

// Loop templates — one-tap examples in the loop editor.
const LOOP_TEMPLATES = {
  api: [
    { name: "Morning briefing", every: 1440,
      prompt: "Good morning! Search the web and give me a 6-bullet briefing: top world news, top tech news, and anything genuinely surprising. Keep it tight." },
    { name: "Markets pulse", every: 180,
      prompt: "Check current market conditions: S&P 500, Nasdaq, Bitcoin, and anything moving unusually. 4 bullets max. Note big changes since your last check." },
    { name: "News watch", every: 60,
      prompt: "Search for breaking news from the last hour. If nothing truly notable happened, reply with just 'Quiet hour.' Only tell me about genuinely important developments — you remember what you already reported." },
    { name: "Daily word & idea", every: 1440,
      prompt: "Teach me one uncommon word worth knowing and one big idea from science or philosophy, in 4 sentences total. Never repeat one you've taught me before." },
  ],
  cli: [
    { name: "Repo health check", every: 60,
      prompt: "Check git status and recent commits. Report: uncommitted changes, new commits since your last check, and anything that looks off. If nothing changed, reply with just 'All quiet.'" },
    { name: "Commit digest", every: 360,
      prompt: "Summarize all commits made since your last run (use git log). Group by theme, flag anything risky. If there are none, reply 'No new commits.'" },
    { name: "Test sentinel", every: 180,
      prompt: "Run the project's test suite if one exists. Report pass/fail counts and any NEW failures compared to your last run." },
    { name: "TODO tracker", every: 1440,
      prompt: "Count TODO/FIXME comments in the codebase. Compare with your last run: what was added, what was resolved? Keep it to 5 bullets." },
  ],
};

// Skills — toggleable instruction packs layered onto the persona.
function defaultSkills() {
  return [
    { id: "sk-direct", name: "🎯 Straight shooter", enabled: true,
      instructions: "Answer first, explain after. No filler, no hedging, no 'great question!'. Prefer lists over paragraphs when listing." },
    { id: "sk-coach", name: "💪 Coach mode", enabled: false,
      instructions: "Act like a supportive but demanding coach: push back on excuses, propose one concrete next action, and follow up on commitments the user made earlier." },
    { id: "sk-eli5", name: "🧒 Explain simply", enabled: false,
      instructions: "Explain technical topics with everyday analogies first, precision second. Define any jargon the moment you use it." },
    { id: "sk-devil", name: "😈 Devil's advocate", enabled: false,
      instructions: "After answering, add a short 'Counterpoint:' section that genuinely challenges the answer or the user's framing." },
    { id: "sk-polyglot", name: "🌐 Language tutor", enabled: false,
      instructions: "When the user writes in or asks about a foreign language, correct mistakes gently, explain the grammar in one line, and offer a more natural phrasing." },
    { id: "sk-planner", name: "📅 Planner", enabled: false,
      instructions: "When the user describes something they want to do, turn it into a concrete plan: numbered steps, rough time estimates, and the single most likely blocker." },
    { id: "sk-privacy", name: "🔒 Privacy guard", enabled: false,
      instructions: "Never write passwords, card numbers, or government IDs into long-term memory. If the user shares something highly sensitive, gently note that you won't remember it." },
  ];
}

const SKILL_TEMPLATES = [
  { name: "✍️ Ghostwriter", instructions: "When drafting text for the user, match their voice from earlier messages, offer 2 variants (safe + bold), and keep subject lines under 8 words." },
  { name: "🧑‍🍳 Chef", instructions: "For any food question: suggest a dish, list ingredients with amounts, then numbered steps. Always include one shortcut and one upgrade." },
  { name: "📊 Analyst", instructions: "Quantify everything you can. Use tables for comparisons. State your confidence level and what data would change your answer." },
  { name: "🧘 Minimalist", instructions: "Reply in 3 sentences or fewer unless the user explicitly asks for depth." },
  { name: "💼 Negotiator", instructions: "When money, salaries, or deals come up: give the user an anchor number, a walk-away point, and one phrase to say verbatim." },
  { name: "🎓 Study buddy", instructions: "When the user is learning something, end each answer with one quick quiz question about it. Grade their previous answer honestly first." },
  { name: "🧾 Budgeter", instructions: "When purchases come up, compare cost against alternatives, note the per-month equivalent, and give a clear buy / wait / skip verdict." },
  { name: "🩺 Health coach", instructions: "For health and fitness topics: practical, evidence-based guidance, no diagnosis, and always flag when something deserves a real doctor." },
];

/* ---------- system prompt composition ---------- */

function composeSystemPrompt() {
  let sys = state.settings.persona || DEFAULT_PERSONA;
  const active = state.skills.filter((s) => s.enabled && s.instructions);
  if (active.length) {
    sys +=
      "\n\n# Active skills\n" +
      active.map((s) => "## " + s.name + "\n" + s.instructions).join("\n");
  }
  if (state.settings.selfLearn !== false && state.memory.length) {
    sys +=
      "\n\n# Long-term memory about this user (learned from past chats)\n" +
      state.memory.map((m) => "- " + m).join("\n");
  }
  return sys;
}

function loadState() {
  const read = (key, fallback) => {
    try {
      const v = JSON.parse(localStorage.getItem(key));
      return v ?? fallback;
    } catch (_) {
      return fallback;
    }
  };
  Object.assign(state.settings, read("pc_settings", {}) || {});
  state.convos = Array.isArray(read("pc_convos", [])) ? read("pc_convos", []) : [];
  state.loops = Array.isArray(read("pc_loops", [])) ? read("pc_loops", []) : [];
  state.memory = Array.isArray(read("pc_memory", [])) ? read("pc_memory", []) : [];
  const skills = read("pc_skills", null);
  state.skills = Array.isArray(skills) ? skills : defaultSkills();
  state.currentId = localStorage.getItem("pc_current") || null;
}

function saveSettings() {
  localStorage.setItem("pc_settings", JSON.stringify(state.settings));
}
function saveConvos() {
  localStorage.setItem("pc_convos", JSON.stringify(state.convos));
  if (state.currentId) localStorage.setItem("pc_current", state.currentId);
}
function saveLoops() {
  localStorage.setItem("pc_loops", JSON.stringify(state.loops));
}
function saveSkills() {
  localStorage.setItem("pc_skills", JSON.stringify(state.skills));
}
function saveMemory() {
  localStorage.setItem("pc_memory", JSON.stringify(state.memory));
}

function currentConvo() {
  return state.convos.find((c) => c.id === state.currentId) || null;
}

function newConvo() {
  const convo = {
    id: "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    title: "New chat",
    messages: [],
    updated: Date.now(),
  };
  state.convos.unshift(convo);
  state.currentId = convo.id;
  saveConvos();
  renderConvoList();
  renderMessages();
  return convo;
}

/* ---------- DOM ---------- */

const $ = (id) => document.getElementById(id);
const messagesEl = $("messages");
const welcomeEl = $("welcome");
const chatEl = $("chat");
const inputEl = $("input");
const sendBtn = $("send-btn");

/* ---------- tiny markdown renderer ---------- */

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderInline(s) {
  return s
    .replace(/`([^`]+)`/g, (_, c) => "<code>" + c + "</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener">$1</a>'
    );
}

function renderTable(rows) {
  // rows: raw escaped "|" lines; rows[1] is the separator
  const cells = (line) => {
    const c = line.split("|").map((x) => x.trim());
    if (c[0] === "") c.shift();
    if (c.length && c[c.length - 1] === "") c.pop();
    return c;
  };
  let html = '<div class="tablewrap"><table><thead><tr>';
  for (const c of cells(rows[0])) html += "<th>" + renderInline(c) + "</th>";
  html += "</tr></thead><tbody>";
  for (let i = 2; i < rows.length; i++) {
    html += "<tr>";
    for (const c of cells(rows[i])) html += "<td>" + renderInline(c) + "</td>";
    html += "</tr>";
  }
  return html + "</tbody></table></div>";
}

function renderMarkdown(text) {
  const escaped = escapeHtml(text);
  const parts = escaped.split(/```/);
  let html = "";
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 1) {
      // code fence: first line may be the language tag
      const body = parts[i].replace(/^[a-zA-Z0-9_+-]*\n/, "");
      html +=
        '<div class="codewrap"><button class="code-copy">copy</button>' +
        "<pre><code>" + body + "</code></pre></div>";
      continue;
    }
    const lines = parts[i].split("\n");
    let para = [];
    let list = null; // "ul" | "ol"
    let table = [];
    const flushPara = () => {
      if (para.length) {
        html += "<p>" + renderInline(para.join("<br>")) + "</p>";
        para = [];
      }
    };
    const closeList = () => {
      if (list) { html += "</" + list + ">"; list = null; }
    };
    const flushTable = () => {
      if (table.length >= 2 && /^[\s|:\-]+$/.test(table[1])) {
        html += renderTable(table);
      } else {
        for (const raw of table) para.push(raw);
        flushPara();
      }
      table = [];
    };
    for (const line of lines) {
      const isTableLine = /^\s*\|.*\|\s*$/.test(line);
      if (isTableLine) {
        flushPara(); closeList();
        table.push(line);
        continue;
      }
      if (table.length) flushTable();
      const h = line.match(/^(#{1,4})\s+(.*)/);
      const ul = line.match(/^\s*[-*]\s+(.*)/);
      const ol = line.match(/^\s*\d+[.)]\s+(.*)/);
      const bq = line.match(/^>\s?(.*)/);
      if (h) {
        flushPara(); closeList();
        const lvl = h[1].length;
        html += `<h${lvl}>` + renderInline(h[2]) + `</h${lvl}>`;
      } else if (ul || ol) {
        flushPara();
        const want = ul ? "ul" : "ol";
        if (list !== want) { closeList(); html += "<" + want + ">"; list = want; }
        html += "<li>" + renderInline((ul || ol)[1]) + "</li>";
      } else if (bq) {
        flushPara(); closeList();
        html += "<blockquote>" + renderInline(bq[1]) + "</blockquote>";
      } else if (line.trim() === "") {
        flushPara(); closeList();
      } else {
        closeList();
        para.push(line);
      }
    }
    if (table.length) flushTable();
    flushPara(); closeList();
  }
  return html;
}

function copyText(text) {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text).catch(() => copyTextFallback(text));
  }
  copyTextFallback(text); // http:// LAN origins have no clipboard API
}
function copyTextFallback(text) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand("copy"); } catch (_) {}
  ta.remove();
}

/* ---------- rendering ---------- */

function backendConfigured() {
  return state.settings.backend === "cli" || !!state.settings.apiKey;
}

function renderMessages() {
  const convo = currentConvo();
  messagesEl.innerHTML = "";
  const empty = !convo || convo.messages.length === 0;
  welcomeEl.classList.toggle("hidden", !empty);
  $("welcome-hint").classList.toggle("hidden", backendConfigured());
  $("convo-title").textContent = convo && !empty ? convo.title : "PocketClaw";
  if (empty) renderSuggestions();
  if (!convo) return;
  for (const m of convo.messages) {
    const bubble = appendBubble(m.role, m.content, m.thinking, m.images);
    if (m.role === "assistant" && m.content) addCopyAction(bubble, m.content);
  }
  scrollToBottom();
}

function renderSuggestions() {
  const box = $("suggestions");
  box.innerHTML = "";
  if (!backendConfigured()) return;
  let pool = [...(SUGGESTIONS[state.settings.backend] || SUGGESTIONS.api)];
  if (state.settings.backend === "cli") {
    if (state.gatewayTandem) pool = pool.concat(SUGGESTIONS.tandem);
    if (state.gatewayFirecrawl) pool = pool.concat(SUGGESTIONS.firecrawl);
  } else if (state.settings.firecrawl) {
    pool = pool.concat(SUGGESTIONS.firecrawl);
  }
  const picks = pool.sort(() => Math.random() - 0.5).slice(0, 4);
  for (const [emoji, text] of picks) {
    const chip = document.createElement("button");
    chip.className = "suggestion-chip";
    chip.textContent = emoji + " " + text;
    chip.onclick = () => {
      inputEl.value = text;
      autoresize();
      inputEl.focus();
    };
    box.appendChild(chip);
  }
  const more = document.createElement("button");
  more.className = "suggestion-chip more-chip";
  more.textContent = "↻ More ideas";
  more.onclick = renderSuggestions;
  box.appendChild(more);
}

function appendBubble(role, content, thinking, images) {
  const wrap = document.createElement("div");
  wrap.className = "msg " + role;
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  if (images && images.length) {
    const strip = document.createElement("div");
    strip.className = "msg-images";
    for (const im of images) {
      const img = document.createElement("img");
      img.src = "data:" + im.media_type + ";base64," + im.data;
      strip.appendChild(img);
    }
    bubble.appendChild(strip);
  }
  if (role === "assistant") {
    if (thinking) {
      const t = document.createElement("div");
      t.className = "thinking-box";
      t.innerHTML =
        '<span class="thinking-label">Thought process</span>' + escapeHtml(thinking);
      bubble.appendChild(t);
    }
    const body = document.createElement("div");
    body.className = "md-body";
    body.innerHTML = renderMarkdown(content);
    bubble.appendChild(body);
  } else if (content) {
    const txt = document.createElement("div");
    txt.textContent = content;
    bubble.appendChild(txt);
  }
  wrap.appendChild(bubble);
  messagesEl.appendChild(wrap);
  return bubble;
}

function addCopyAction(bubble, rawText) {
  const actions = document.createElement("div");
  actions.className = "msg-actions";
  const btn = document.createElement("button");
  btn.textContent = "⧉ copy";
  btn.onclick = () => {
    copyText(rawText);
    btn.textContent = "✓ copied";
    setTimeout(() => (btn.textContent = "⧉ copy"), 1200);
  };
  actions.appendChild(btn);
  if (navigator.share) {
    const share = document.createElement("button");
    share.textContent = "↗ share";
    share.onclick = () =>
      navigator.share({ text: rawText, title: "PocketClaw" }).catch(() => {});
    actions.appendChild(share);
  }
  bubble.appendChild(actions);
}

function appendError(text) {
  const div = document.createElement("div");
  div.className = "error-note";
  div.textContent = text;
  messagesEl.appendChild(div);
  scrollToBottom();
}

function scrollToBottom() {
  chatEl.scrollTop = chatEl.scrollHeight;
}

function renderConvoList() {
  const ul = $("convo-list");
  ul.innerHTML = "";
  for (const c of state.convos) {
    const li = document.createElement("li");
    if (c.id === state.currentId) li.classList.add("active");
    const name = document.createElement("span");
    name.className = "convo-name";
    name.textContent = c.title;
    name.onclick = () => {
      state.currentId = c.id;
      saveConvos();
      renderConvoList();
      renderMessages();
      closeDrawer();
    };
    const del = document.createElement("button");
    del.className = "convo-del";
    del.textContent = "✕";
    del.onclick = () => {
      if (!confirm("Delete this conversation?")) return;
      state.convos = state.convos.filter((x) => x.id !== c.id);
      if (state.currentId === c.id) state.currentId = state.convos[0]?.id || null;
      saveConvos();
      renderConvoList();
      renderMessages();
    };
    li.appendChild(name);
    li.appendChild(del);
    ul.appendChild(li);
  }
}

/* ---------- Anthropic API ---------- */

function apiHeaders() {
  return {
    "content-type": "application/json",
    "x-api-key": state.settings.apiKey,
    "anthropic-version": API_VERSION,
    // Required for calling the API directly from a browser:
    "anthropic-dangerous-direct-browser-access": "true",
  };
}

async function fetchModels() {
  const res = await fetch(API_BASE + "/v1/models?limit=100", {
    headers: apiHeaders(),
  });
  if (!res.ok) throw new Error("models fetch failed: " + res.status);
  const data = await res.json();
  return (data.data || []).map((m) => ({ id: m.id, label: m.display_name || m.id }));
}

function searchToolVariant(model) {
  // dynamic-filtering variant needs Opus 4.6+/Sonnet 4.6+/Fable; older models
  // (e.g. Haiku 4.5) use the basic one
  return ADAPTIVE_RE.test(model) ? "web_search_20260209" : "web_search_20250305";
}

function buildRequestBody(convo) {
  const s = state.settings;
  const body = {
    model: s.model,
    max_tokens: Math.max(256, Math.min(64000, Number(s.maxTokens) || 8192)),
    stream: true,
    system: [
      {
        type: "text",
        text: composeSystemPrompt(),
        cache_control: { type: "ephemeral" },
      },
    ],
    // Plain text history (+ image blocks) — thinking is display-only in this app.
    messages: convo.messages.map((m) => {
      if (m.images && m.images.length) {
        return {
          role: m.role,
          content: [
            ...m.images.map((im) => ({
              type: "image",
              source: { type: "base64", media_type: im.media_type, data: im.data },
            })),
            { type: "text", text: m.content },
          ],
        };
      }
      return { role: m.role, content: m.content };
    }),
  };
  const tools = [];
  if (s.webSearch) {
    tools.push({ type: searchToolVariant(s.model), name: "web_search", max_uses: 5 });
  }
  if (s.firecrawl) {
    // Firecrawl's hosted MCP server via the Claude API MCP connector
    const server = {
      type: "url",
      url: "https://mcp.firecrawl.dev/v2/mcp",
      name: "firecrawl",
    };
    if (s.firecrawlKey) server.authorization_token = s.firecrawlKey;
    body.mcp_servers = [server];
    tools.push({ type: "mcp_toolset", mcp_server_name: "firecrawl" });
  }
  if (tools.length) body.tools = tools;
  const adaptive = ADAPTIVE_RE.test(s.model);
  const isFable = /fable-5|mythos-5/.test(s.model);
  if (adaptive && s.thinking) {
    // Fable 5 has thinking always on; adaptive + summarized is accepted there too.
    body.thinking = { type: "adaptive", display: "summarized" };
  } else if (adaptive && !isFable) {
    body.thinking = { type: "disabled" };
  }
  if (adaptive && s.effort) {
    body.output_config = { effort: s.effort };
  }
  return body;
}

async function streamChat(convo, onThinking, onText, onActivity, signal) {
  const headers = apiHeaders();
  if (state.settings.firecrawl) headers["anthropic-beta"] = "mcp-client-2025-11-20";
  const res = await fetch(API_BASE + "/v1/messages", {
    method: "POST",
    headers,
    body: JSON.stringify(buildRequestBody(convo)),
    signal,
  });

  if (!res.ok) {
    let msg = "HTTP " + res.status;
    try {
      const err = await res.json();
      msg = err?.error?.message || msg;
    } catch (_) {}
    throw new Error(msg);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let stopReason = null;
  const blockTypes = {};  // index -> content block type
  const toolInputs = {};  // index -> accumulated partial JSON for server tools

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    // SSE events are separated by a blank line
    let sep;
    while ((sep = buf.indexOf("\n\n")) !== -1) {
      const rawEvent = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      for (const line of rawEvent.split("\n")) {
        if (!line.startsWith("data:")) continue;
        let ev;
        try {
          ev = JSON.parse(line.slice(5).trim());
        } catch (_) {
          continue;
        }
        switch (ev.type) {
          case "content_block_start": {
            const b = ev.content_block;
            blockTypes[ev.index] = b.type;
            if (b.type === "server_tool_use") toolInputs[ev.index] = "";
            else if (b.type === "web_search_tool_result") {
              const n = Array.isArray(b.content) ? b.content.length : 0;
              onActivity(n ? "🔍 " + n + " results" : "🔍 search finished");
            } else if (b.type === "mcp_tool_use") {
              onActivity("🔥 " + (b.name || "web tool"));
            }
            break;
          }
          case "content_block_delta":
            if (ev.delta.type === "text_delta") onText(ev.delta.text);
            else if (ev.delta.type === "thinking_delta") onThinking(ev.delta.thinking);
            else if (
              ev.delta.type === "input_json_delta" &&
              blockTypes[ev.index] === "server_tool_use"
            ) {
              toolInputs[ev.index] += ev.delta.partial_json || "";
            }
            break;
          case "content_block_stop":
            if (blockTypes[ev.index] === "server_tool_use") {
              let label = "🔍 Searching the web…";
              try {
                const q = JSON.parse(toolInputs[ev.index] || "{}").query;
                if (q) label = "🔍 Searching: “" + q + "”";
              } catch (_) {}
              onActivity(label);
            }
            break;
          case "message_delta":
            if (ev.delta && ev.delta.stop_reason) stopReason = ev.delta.stop_reason;
            break;
          case "error":
            throw new Error(ev.error?.message || "stream error");
        }
      }
    }
  }
  return stopReason;
}

/* ---------- PocketClaw gateway (Claude Code CLI) ---------- */

function gatewayBase() {
  const u = (state.settings.gatewayUrl || "").trim().replace(/\/+$/, "");
  return u || location.origin;
}

function gwHeaders() {
  const headers = { "content-type": "application/json" };
  if (state.settings.gatewayToken) {
    headers.authorization = "Bearer " + state.settings.gatewayToken;
  }
  return headers;
}

// Tandem/Firecrawl config to forward to the gateway. Each key: an object turns
// it ON with that config, null turns it OFF, so the gateway always reflects the
// app's current choice.
function gwMcpConfig() {
  const s = state.settings;
  return {
    tandem: s.cliTandem && s.cliTandemUrl
      ? { url: s.cliTandemUrl, token: s.cliTandemToken || undefined }
      : null,
    firecrawl: s.cliFirecrawl
      ? { key: s.cliFirecrawlKey || undefined }
      : null,
  };
}

async function streamChatCli(convo, userText, images, onThinking, onText, onTool, signal) {
  const res = await fetch(gatewayBase() + "/api/chat", {
    method: "POST",
    headers: gwHeaders(),
    body: JSON.stringify({
      prompt: userText,
      sessionId: convo.cliSessionId || undefined,
      persona: composeSystemPrompt(),
      // cloud gateways without their own Claude login use this key instead
      anthropicKey: state.settings.apiKey || undefined,
      mcp: gwMcpConfig(),
      images: images && images.length ? images : undefined,
    }),
    signal,
  });

  if (!res.ok) {
    let msg = "gateway HTTP " + res.status;
    try {
      const err = await res.json();
      msg = err?.error || msg;
    } catch (_) {}
    throw new Error(msg);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let result = { sessionId: null };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let sep;
    while ((sep = buf.indexOf("\n\n")) !== -1) {
      const rawEvent = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      for (const line of rawEvent.split("\n")) {
        if (!line.startsWith("data:")) continue;
        let ev;
        try {
          ev = JSON.parse(line.slice(5).trim());
        } catch (_) {
          continue;
        }
        if (ev.type === "text") onText(ev.text);
        else if (ev.type === "thinking") onThinking(ev.text);
        else if (ev.type === "tool") onTool(ev.name, ev.preview || "");
        else if (ev.type === "done") result.sessionId = ev.session_id;
        else if (ev.type === "error") throw new Error(ev.message || "gateway error");
      }
    }
  }
  return result;
}

/* ---------- send flow ---------- */

async function send() {
  if (state.streaming) {
    state.abort?.abort();
    return;
  }
  const text = inputEl.value.trim();
  if (!text) return;
  if (!backendConfigured()) {
    openSettings();
    return;
  }

  let convo = currentConvo() || newConvo();
  const images = state.pendingImages.splice(0);
  renderAttachStrip();
  const userMsg = { role: "user", content: text };
  if (images.length) userMsg.images = images;
  convo.messages.push(userMsg);
  if (convo.messages.length === 1) {
    convo.title = text.length > 42 ? text.slice(0, 42) + "…" : text;
  }
  convo.updated = Date.now();
  saveConvos();

  inputEl.value = "";
  autoresize();
  welcomeEl.classList.add("hidden");
  $("convo-title").textContent = convo.title;
  appendBubble("user", text, null, images);
  scrollToBottom();

  // live assistant bubble
  const bubble = appendBubble("assistant", "");
  const body = bubble.querySelector(".md-body");
  body.classList.add("cursor-blink");
  let thinkingBox = null;
  let assistantText = "";
  let thinkingText = "";
  let pending = false;

  const doPaint = () => {
    if (thinkingText && !thinkingBox) {
      thinkingBox = document.createElement("div");
      thinkingBox.className = "thinking-box";
      const label = state.settings.backend === "cli" ? "Working…" : "Thinking…";
      thinkingBox.innerHTML = '<span class="thinking-label">' + label + "</span>";
      const span = document.createElement("span");
      thinkingBox.appendChild(span);
      bubble.insertBefore(thinkingBox, body);
    }
    if (thinkingBox) thinkingBox.lastChild.textContent = thinkingText;
    body.innerHTML = renderMarkdown(assistantText);
    body.classList.toggle("cursor-blink", state.streaming);
    scrollToBottom();
  };
  const paint = () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      doPaint();
    });
  };

  state.streaming = true;
  state.abort = new AbortController();
  sendBtn.textContent = "◼";
  sendBtn.classList.add("stop");
  buzz(10);

  let stopReason = null;
  let errorMsg = null;
  const onThinking = (t) => { thinkingText += t; paint(); };
  const onText = (t) => { assistantText += t; paint(); };
  const onActivity = (line) => {
    thinkingText +=
      (thinkingText && !thinkingText.endsWith("\n") ? "\n" : "") + line + "\n";
    paint();
  };
  try {
    if (state.settings.backend === "cli") {
      const onTool = (name, preview) =>
        onActivity("🔧 " + name + (preview ? "  " + preview : ""));
      const r = await streamChatCli(
        convo, text, images, onThinking, onText, onTool, state.abort.signal
      );
      if (r.sessionId) convo.cliSessionId = r.sessionId;
      stopReason = "end_turn";
    } else {
      stopReason = await streamChat(
        convo, onThinking, onText, onActivity, state.abort.signal
      );
    }
  } catch (e) {
    if (e.name === "AbortError") stopReason = "aborted";
    else errorMsg = e.message || String(e);
  }

  state.streaming = false;
  state.abort = null;
  sendBtn.textContent = "➤";
  sendBtn.classList.remove("stop");
  buzz(20);
  doPaint(); // final synchronous paint — a queued rAF may not have fired yet
  if (thinkingBox) {
    thinkingBox.firstChild.textContent =
      state.settings.backend === "cli" ? "Agent activity" : "Thought process";
  }

  if (errorMsg) {
    bubble.parentElement.remove();
    convo.messages.pop(); // let the user retry the same message
    inputEl.value = text;
    autoresize();
    appendError("⚠ " + errorMsg);
    saveConvos();
    return;
  }

  if (stopReason === "refusal" && !assistantText) {
    assistantText = "*(Claude declined to answer this request.)*";
    body.innerHTML = renderMarkdown(assistantText);
  } else if (stopReason === "max_tokens") {
    assistantText += "\n\n*(Response hit the max-token limit — raise it in Settings to continue.)*";
    body.innerHTML = renderMarkdown(assistantText);
  }

  if (assistantText) {
    convo.messages.push({
      role: "assistant",
      content: assistantText,
      thinking: thinkingText || undefined,
    });
    addCopyAction(bubble, assistantText);
    autoTitle(convo);
    learnFromExchange(convo);
  } else if (stopReason === "aborted") {
    convo.messages.pop(); // nothing came back; drop the user turn so history stays valid
    inputEl.value = text;
    autoresize();
  }
  convo.updated = Date.now();
  saveConvos();
  renderConvoList();
}

/* ---------- smart conversation titles (cheap Haiku call) ---------- */

async function autoTitle(convo) {
  if (convo.titleDone || !state.settings.apiKey || convo.messages.length < 2) return;
  convo.titleDone = true; // one attempt per conversation
  try {
    const first = convo.messages[0];
    const reply = convo.messages.find((m) => m.role === "assistant");
    const res = await fetch(API_BASE + "/v1/messages", {
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 30,
        system:
          "You title conversations. Reply with ONLY a title of 2-5 words. " +
          "No quotes, no punctuation at the end.",
        messages: [
          {
            role: "user",
            content:
              "User: " + String(first.content).slice(0, 500) +
              "\n\nAssistant: " + String(reply?.content || "").slice(0, 500),
          },
        ],
      }),
    });
    if (!res.ok) return;
    const data = await res.json();
    const t = data?.content?.find((b) => b.type === "text")?.text?.trim();
    if (t) {
      convo.title = t.slice(0, 60);
      saveConvos();
      renderConvoList();
      if (convo.id === state.currentId) $("convo-title").textContent = convo.title;
    }
  } catch (_) {
    /* title stays as the truncated first message */
  }
}

/* ---------- self-learning memory ---------- */

async function learnFromExchange(convo) {
  if (state.settings.selfLearn === false || !state.settings.apiKey) return;
  const msgs = convo.messages;
  if (msgs.length < 2) return;
  const user = msgs[msgs.length - 2];
  const reply = msgs[msgs.length - 1];
  if (!user || user.role !== "user") return;
  try {
    const res = await fetch(API_BASE + "/v1/messages", {
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 800,
        system:
          "You maintain a small long-term memory for a personal assistant. " +
          "Given the current memory and the latest exchange, output the COMPLETE " +
          "updated memory as a JSON array of short strings (max 25 items, each " +
          "under 140 chars). Keep only durable, useful facts about the user: name, " +
          "preferences, projects, goals, people, recurring context. Merge duplicates, " +
          "drop stale items, never invent facts. Output ONLY the JSON array.",
        messages: [
          {
            role: "user",
            content:
              "Current memory:\n" + JSON.stringify(state.memory) +
              "\n\nLatest exchange:\nUser: " + String(user.content).slice(0, 1200) +
              "\nAssistant: " + String(reply.content).slice(0, 1200),
          },
        ],
      }),
    });
    if (!res.ok) return;
    const data = await res.json();
    const text = data?.content?.find((b) => b.type === "text")?.text || "";
    const jsonStr = text.slice(text.indexOf("["), text.lastIndexOf("]") + 1);
    const mem = JSON.parse(jsonStr);
    if (Array.isArray(mem)) {
      state.memory = mem.filter((m) => typeof m === "string").slice(0, 25);
      saveMemory();
    }
  } catch (_) {
    /* memory keeps its previous state */
  }
}

/* ---------- loops: scheduled prompts ---------- */

function fmtEvery(min) {
  return min >= 1440 ? min / 1440 + "d" : min >= 60 ? min / 60 + "h" : min + "m";
}

function ensureLoopConvo(loop) {
  let convo = state.convos.find((c) => c.id === loop.convoId);
  if (!convo) {
    convo = {
      id: "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      title: "🔁 " + loop.name,
      messages: [],
      titleDone: true, // loop convos keep their loop name
      updated: Date.now(),
    };
    state.convos.unshift(convo);
    loop.convoId = convo.id;
    saveLoops();
    saveConvos();
  }
  return convo;
}

function renderLoopList() {
  const ul = $("loop-list");
  ul.innerHTML = "";
  for (const loop of state.loops) {
    const li = document.createElement("li");
    const dot = document.createElement("span");
    dot.className = "loop-dot" + (loop.enabled ? " on" : "");
    const name = document.createElement("span");
    name.className = "loop-name";
    name.textContent = loop.name;
    const meta = document.createElement("span");
    meta.className = "loop-meta";
    meta.textContent =
      fmtEvery(loop.every) +
      (loop.lastRunAt ? " · " + new Date(loop.lastRunAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "");
    li.appendChild(dot);
    li.appendChild(name);
    li.appendChild(meta);
    li.onclick = () => openLoopEditor(loop.id);
    ul.appendChild(li);
  }
}

let editingLoopId = null;

function openLoopEditor(loopId) {
  editingLoopId = loopId;
  const loop = state.loops.find((l) => l.id === loopId);
  $("loop-modal-title").textContent = loop ? "Edit loop" : "New loop";
  $("loop-name").value = loop?.name || "";
  $("loop-prompt").value = loop?.prompt || "";
  $("loop-every").value = String(loop?.every || 60);
  $("loop-enabled").checked = loop ? !!loop.enabled : true;
  $("loop-delete").classList.toggle("hidden", !loop);
  $("loop-run-now").classList.toggle("hidden", !loop);
  const tpls = $("loop-templates");
  tpls.innerHTML = "";
  const set = LOOP_TEMPLATES[state.settings.backend] || LOOP_TEMPLATES.api;
  for (const t of set) {
    const chip = document.createElement("button");
    chip.className = "suggestion-chip";
    chip.textContent = t.name;
    chip.onclick = () => {
      $("loop-name").value = t.name;
      $("loop-prompt").value = t.prompt;
      $("loop-every").value = String(t.every);
    };
    tpls.appendChild(chip);
  }
  $("loop-backdrop").classList.remove("hidden");
}

function closeLoopEditor() {
  $("loop-backdrop").classList.add("hidden");
  editingLoopId = null;
}

function saveLoopFromForm() {
  const name = $("loop-name").value.trim();
  const prompt = $("loop-prompt").value.trim();
  if (!name || !prompt) {
    alert("A loop needs a name and a prompt.");
    return;
  }
  let loop = state.loops.find((l) => l.id === editingLoopId);
  if (!loop) {
    loop = { id: "l" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) };
    state.loops.push(loop);
  }
  loop.name = name;
  loop.prompt = prompt;
  loop.every = Number($("loop-every").value) || 60;
  loop.enabled = $("loop-enabled").checked;
  const convo = state.convos.find((c) => c.id === loop.convoId);
  if (convo) { convo.title = "🔁 " + name; saveConvos(); }
  saveLoops();
  renderLoopList();
  renderConvoList();
  pushLoopsToGateway();
  closeLoopEditor();
}

function deleteLoopFromForm() {
  if (!editingLoopId) return;
  if (!confirm("Delete this loop? (Its conversation stays.)")) return;
  state.loops = state.loops.filter((l) => l.id !== editingLoopId);
  saveLoops();
  renderLoopList();
  pushLoopsToGateway();
  closeLoopEditor();
}

async function pushLoopsToGateway() {
  if (state.settings.backend !== "cli") return;
  try {
    await fetch(gatewayBase() + "/api/loops", {
      method: "PUT",
      headers: gwHeaders(),
      body: JSON.stringify({
        loops: state.loops.map((l) => ({
          id: l.id, name: l.name, prompt: l.prompt, every: l.every, enabled: l.enabled,
        })),
        // so background loops get the same browser/web tools
        mcp: gwMcpConfig(),
        anthropicKey: state.settings.apiKey || undefined,
      }),
    });
  } catch (_) {}
}

// CLI mode: the gateway runs loops in the background; pull new results in.
async function syncLoopRuns() {
  if (state.settings.backend !== "cli" || !state.loops.length) return;
  let serverLoops;
  try {
    const res = await fetch(gatewayBase() + "/api/loops", { headers: gwHeaders() });
    if (!res.ok) return;
    serverLoops = (await res.json()).loops || [];
  } catch (_) {
    return;
  }
  let changed = false;
  for (const sl of serverLoops) {
    const loop = state.loops.find((l) => l.id === sl.id);
    if (!loop) continue;
    loop.lastRunAt = sl.lastRunAt || loop.lastRunAt;
    const newRuns = (sl.runs || []).filter((r) => r.at > (loop.syncedUpTo || 0));
    if (!newRuns.length) continue;
    const convo = ensureLoopConvo(loop);
    for (const run of newRuns) {
      convo.messages.push({
        role: "user",
        content: "🔁 " + loop.name + " — " + new Date(run.at).toLocaleString(),
      });
      convo.messages.push({
        role: "assistant",
        content: run.isError ? "⚠ " + run.text : run.text,
      });
      loop.syncedUpTo = run.at;
    }
    if (sl.sessionId) convo.cliSessionId = sl.sessionId;
    convo.updated = Date.now();
    changed = true;
  }
  if (changed) {
    saveLoops();
    saveConvos();
    renderConvoList();
    renderLoopList();
    if (currentConvo() && state.loops.some((l) => l.convoId === state.currentId)) {
      renderMessages();
    }
  }
}

// API mode: run due loops client-side while the app is open.
async function runLoopApi(loop) {
  if (state.loopBusy || state.streaming) return;
  state.loopBusy = true;
  loop.lastRunAt = Date.now();
  saveLoops();
  renderLoopList();
  const convo = ensureLoopConvo(loop);
  convo.messages.push({ role: "user", content: loop.prompt });
  let text = "";
  try {
    await streamChat(
      convo,
      () => {},
      (t) => { text += t; },
      () => {},
      undefined
    );
  } catch (e) {
    text = "⚠ Loop run failed: " + (e.message || e);
  }
  convo.messages.push({ role: "assistant", content: text || "(no output)" });
  convo.updated = Date.now();
  saveConvos();
  renderConvoList();
  if (state.currentId === convo.id) renderMessages();
  state.loopBusy = false;
}

function runLoopNow(loopId) {
  const loop = state.loops.find((l) => l.id === loopId);
  if (!loop) return;
  if (state.settings.backend === "cli") {
    pushLoopsToGateway().then(() =>
      fetch(gatewayBase() + "/api/loops/run?id=" + encodeURIComponent(loop.id), {
        method: "POST",
        headers: gwHeaders(),
      }).catch(() => {})
    );
    setTimeout(syncLoopRuns, 20000);
    setTimeout(syncLoopRuns, 60000);
  } else {
    runLoopApi(loop);
  }
  closeLoopEditor();
  closeDrawer();
}

function checkLoops() {
  const now = Date.now();
  if (state.settings.backend === "cli") {
    syncLoopRuns();
    return;
  }
  if (!state.settings.apiKey) return;
  for (const loop of state.loops) {
    if (!loop.enabled) continue;
    const every = Math.max(5, Number(loop.every) || 60) * 60000;
    if (!loop.lastRunAt || now - loop.lastRunAt >= every) {
      runLoopApi(loop);
      break; // one per tick
    }
  }
}

/* ---------- skills manager ---------- */

let editingSkillId = null;

function renderSkillList() {
  const ul = $("skill-list");
  ul.innerHTML = "";
  for (const skill of state.skills) {
    const li = document.createElement("li");
    const dot = document.createElement("span");
    dot.className = "loop-dot" + (skill.enabled ? " on" : "");
    dot.title = skill.enabled ? "enabled" : "disabled";
    dot.onclick = (e) => {
      e.stopPropagation();
      skill.enabled = !skill.enabled;
      saveSkills();
      renderSkillList();
    };
    const name = document.createElement("span");
    name.className = "loop-name";
    name.textContent = skill.name;
    li.appendChild(dot);
    li.appendChild(name);
    li.onclick = () => openSkillEditor(skill.id);
    ul.appendChild(li);
  }
}

function openSkillEditor(skillId) {
  editingSkillId = skillId;
  const skill = state.skills.find((s) => s.id === skillId);
  $("skill-modal-title").textContent = skill ? "Edit skill" : "New skill";
  $("skill-name").value = skill?.name || "";
  $("skill-instructions").value = skill?.instructions || "";
  $("skill-enabled").checked = skill ? !!skill.enabled : true;
  $("skill-delete").classList.toggle("hidden", !skill);
  const tpls = $("skill-templates");
  tpls.innerHTML = "";
  const addChip = (t) => {
    const chip = document.createElement("button");
    chip.className = "suggestion-chip";
    chip.textContent = t.name;
    chip.onclick = () => {
      $("skill-name").value = t.name;
      $("skill-instructions").value = t.instructions;
    };
    tpls.appendChild(chip);
    return chip;
  };
  for (const t of SKILL_TEMPLATES) addChip(t);
  // ✨ PocketClaw invents skills tailored to how you actually use it
  const suggest = document.createElement("button");
  suggest.className = "suggestion-chip more-chip";
  suggest.id = "suggest-skills";
  suggest.textContent = "✨ Suggest from my chats";
  suggest.onclick = () => suggestSkills(suggest, addChip);
  tpls.appendChild(suggest);
  $("skill-backdrop").classList.remove("hidden");
}

async function suggestSkills(btn, addChip) {
  if (!state.settings.apiKey) {
    alert("Add your Anthropic API key in Settings to get personalized suggestions.");
    return;
  }
  btn.disabled = true;
  btn.textContent = "✨ thinking…";
  try {
    const recent = state.convos
      .slice(0, 8)
      .flatMap((c) => c.messages.filter((m) => m.role === "user").slice(0, 3))
      .map((m) => String(m.content).slice(0, 140))
      .slice(0, 20);
    const res = await fetch(API_BASE + "/v1/messages", {
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 700,
        system:
          'You design "skills" (behavior instructions) for a personal assistant, ' +
          "tailored to how this user actually uses it. Output ONLY a JSON array of " +
          'exactly 3 items shaped {"name":"<emoji> <2-3 words>","instructions":"<one ' +
          'or two sentences of behavior instructions>"}. Make them specific to the ' +
          "user's visible interests, not generic.",
        messages: [
          {
            role: "user",
            content:
              "What I know about the user:\n" + JSON.stringify(state.memory) +
              "\n\nTheir recent messages:\n" + JSON.stringify(recent),
          },
        ],
      }),
    });
    const data = await res.json();
    const text = data?.content?.find((b) => b.type === "text")?.text || "";
    const arr = JSON.parse(text.slice(text.indexOf("["), text.lastIndexOf("]") + 1));
    for (const t of arr.slice(0, 3)) {
      if (t && t.name && t.instructions) {
        const chip = addChip({ name: String(t.name).slice(0, 40), instructions: String(t.instructions).slice(0, 500) });
        chip.classList.add("suggested");
      }
    }
    btn.remove();
  } catch (e) {
    btn.disabled = false;
    btn.textContent = "✨ Suggest from my chats";
    alert("Couldn't get suggestions: " + (e.message || e));
  }
}

function closeSkillEditor() {
  $("skill-backdrop").classList.add("hidden");
  editingSkillId = null;
}

function saveSkillFromForm() {
  const name = $("skill-name").value.trim();
  const instructions = $("skill-instructions").value.trim();
  if (!name || !instructions) {
    alert("A skill needs a name and instructions.");
    return;
  }
  let skill = state.skills.find((s) => s.id === editingSkillId);
  if (!skill) {
    skill = { id: "sk" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) };
    state.skills.push(skill);
  }
  skill.name = name;
  skill.instructions = instructions;
  skill.enabled = $("skill-enabled").checked;
  saveSkills();
  renderSkillList();
  closeSkillEditor();
}

function deleteSkillFromForm() {
  if (!editingSkillId) return;
  state.skills = state.skills.filter((s) => s.id !== editingSkillId);
  saveSkills();
  renderSkillList();
  closeSkillEditor();
}

/* ---------- photo attachments ---------- */

function renderAttachStrip() {
  const strip = $("attach-strip");
  strip.innerHTML = "";
  strip.classList.toggle("hidden", state.pendingImages.length === 0);
  state.pendingImages.forEach((im, i) => {
    const box = document.createElement("div");
    box.className = "attach-thumb";
    const img = document.createElement("img");
    img.src = "data:" + im.media_type + ";base64," + im.data;
    const x = document.createElement("button");
    x.className = "attach-x";
    x.textContent = "✕";
    x.onclick = () => {
      state.pendingImages.splice(i, 1);
      renderAttachStrip();
    };
    box.appendChild(img);
    box.appendChild(x);
    strip.appendChild(box);
  });
}

function downscaleImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const MAX = 1280;
      let { width, height } = img;
      if (width > MAX || height > MAX) {
        const k = MAX / Math.max(width, height);
        width = Math.round(width * k);
        height = Math.round(height * k);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
      resolve({ media_type: "image/jpeg", data: dataUrl.split(",")[1] });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("could not read image"));
    };
    img.src = url;
  });
}

async function addImages(files) {
  for (const f of files) {
    if (state.pendingImages.length >= 3) break;
    try {
      state.pendingImages.push(await downscaleImage(f));
    } catch (_) {}
  }
  renderAttachStrip();
}

/* ---------- quick toggles above the composer ---------- */

function setOverdrive(on) {
  const s = state.settings;
  if (on && !state.overdrive) {
    // snapshot the fields Overdrive overrides, then max them out
    state.preOverdrive = {
      model: s.model, effort: s.effort, thinking: s.thinking,
      webSearch: s.webSearch, firecrawl: s.firecrawl, maxTokens: s.maxTokens,
    };
    Object.assign(s, OVERDRIVE);
    state.overdrive = true;
  } else if (!on && state.overdrive) {
    if (state.preOverdrive) Object.assign(s, state.preOverdrive);
    state.preOverdrive = null;
    state.overdrive = false;
  }
  saveSettings();
  syncQuickToggles();
}

function syncQuickToggles() {
  const s = state.settings;
  const cli = s.backend === "cli";
  const od = $("toggle-overdrive");
  if (od) od.setAttribute("aria-checked", state.overdrive ? "true" : "false");
  $("quick-toggles").classList.toggle("overdriven", state.overdrive);
  const setSwitch = (id, on) => {
    const el = $(id);
    if (el) el.setAttribute("aria-checked", on ? "true" : "false");
  };
  setSwitch("toggle-thinking", s.thinking);
  setSwitch("toggle-websearch", s.webSearch);
  setSwitch("toggle-firecrawl", s.firecrawl);
  // Thinking + web search + Firecrawl are API-mode request options; the CLI
  // backend controls these itself, so hide them there. Firecrawl chip only
  // shows in API mode when the user has enabled it in settings.
  $("toggle-thinking").classList.toggle("hidden", cli);
  $("toggle-websearch").classList.toggle("hidden", cli);
  $("toggle-firecrawl").classList.toggle("hidden", cli || !s.firecrawl);
  // Effort applies to both backends' adaptive models.
  document.querySelectorAll(".effort-seg").forEach((seg) => {
    seg.setAttribute("aria-checked", seg.dataset.effort === (s.effort || "") ? "true" : "false");
  });
}

/* ---------- settings UI ---------- */

function updateBackendFields() {
  const cli = $("backend-select").value === "cli";
  $("api-fields").classList.toggle("hidden", cli);
  $("cli-fields").classList.toggle("hidden", !cli);
}

function openSettings() {
  const s = state.settings;
  $("backend-select").value = s.backend;
  $("api-key").value = s.apiKey;
  $("persona").value = s.persona;
  $("thinking-toggle").checked = s.thinking;
  $("websearch-toggle").checked = s.webSearch;
  $("firecrawl-toggle").checked = !!s.firecrawl;
  $("firecrawl-key").value = s.firecrawlKey;
  $("effort-select").value = s.effort;
  $("max-tokens").value = s.maxTokens;
  $("gateway-url").value = s.gatewayUrl;
  $("gateway-token").value = s.gatewayToken;
  $("cli-tandem-toggle").checked = !!s.cliTandem;
  $("cli-tandem-url").value = s.cliTandemUrl;
  $("cli-tandem-token").value = s.cliTandemToken;
  $("cli-firecrawl-toggle").checked = !!s.cliFirecrawl;
  $("cli-firecrawl-key").value = s.cliFirecrawlKey;
  $("selflearn-toggle").checked = s.selfLearn !== false;
  $("memory-edit").value = state.memory.join("\n");
  populateModelSelect(FALLBACK_MODELS);
  updateBackendFields();
  $("settings-backdrop").classList.remove("hidden");
  if (s.apiKey && s.backend === "api") refreshModels(false);
}

function closeSettings() {
  $("settings-backdrop").classList.add("hidden");
}

function populateModelSelect(models) {
  const sel = $("model-select");
  const current = state.settings.model;
  sel.innerHTML = "";
  const seen = new Set();
  for (const m of models) {
    seen.add(m.id);
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = m.label;
    sel.appendChild(opt);
  }
  if (!seen.has(current)) {
    const opt = document.createElement("option");
    opt.value = current;
    opt.textContent = current;
    sel.appendChild(opt);
  }
  sel.value = current;
}

async function refreshModels(interactive) {
  const keyInField = $("api-key").value.trim();
  if (keyInField) state.settings.apiKey = keyInField;
  if (!state.settings.apiKey) {
    if (interactive) alert("Enter your API key first.");
    return;
  }
  try {
    const models = await fetchModels();
    if (models.length) populateModelSelect(models);
  } catch (e) {
    if (interactive) alert("Could not fetch models: " + e.message);
  }
}

function saveSettingsFromForm() {
  const s = state.settings;
  s.backend = $("backend-select").value;
  s.apiKey = $("api-key").value.trim();
  s.model = $("model-select").value;
  s.persona = $("persona").value.trim() || DEFAULT_PERSONA;
  s.thinking = $("thinking-toggle").checked;
  s.webSearch = $("websearch-toggle").checked;
  s.firecrawl = $("firecrawl-toggle").checked;
  s.firecrawlKey = $("firecrawl-key").value.trim();
  s.effort = $("effort-select").value;
  s.maxTokens = Number($("max-tokens").value) || 8192;
  s.gatewayUrl = $("gateway-url").value.trim();
  s.gatewayToken = $("gateway-token").value.trim();
  s.cliTandem = $("cli-tandem-toggle").checked;
  s.cliTandemUrl = $("cli-tandem-url").value.trim();
  s.cliTandemToken = $("cli-tandem-token").value.trim();
  s.cliFirecrawl = $("cli-firecrawl-toggle").checked;
  s.cliFirecrawlKey = $("cli-firecrawl-key").value.trim();
  s.selfLearn = $("selflearn-toggle").checked;
  state.memory = $("memory-edit").value
    .split("\n").map((x) => x.trim()).filter(Boolean).slice(0, 25);
  saveMemory();
  // Editing settings by hand takes explicit control — exit Overdrive and keep
  // the values just chosen (don't restore the old snapshot).
  state.overdrive = false;
  state.preOverdrive = null;
  saveSettings();
  pushLoopsToGateway();
  syncQuickToggles();
  closeSettings();
  renderMessages();
}

/* ---------- drawer ---------- */

function openDrawer() {
  renderConvoList();
  renderLoopList();
  renderSkillList();
  $("drawer").classList.remove("hidden");
  $("drawer-backdrop").classList.remove("hidden");
}
function closeDrawer() {
  $("drawer").classList.add("hidden");
  $("drawer-backdrop").classList.add("hidden");
}

/* ---------- composer ---------- */

function autoresize() {
  inputEl.style.height = "auto";
  inputEl.style.height = Math.min(inputEl.scrollHeight, 140) + "px";
}

function buzz(ms) {
  try { navigator.vibrate?.(ms); } catch (_) {}
}

/* voice dictation via the Web Speech API (feature-detected) */
let recognition = null;
let recording = false;

function setupVoice() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const btn = $("mic-btn");
  if (!SR) {
    btn.classList.add("hidden");
    return;
  }
  btn.onclick = () => {
    if (recording) {
      recognition.stop();
      return;
    }
    recognition = new SR();
    recognition.lang = navigator.language || "en-US";
    recognition.interimResults = true;
    const baseText = inputEl.value ? inputEl.value.replace(/\s+$/, "") + " " : "";
    recognition.onresult = (e) => {
      let text = "";
      for (const r of e.results) text += r[0].transcript;
      inputEl.value = baseText + text;
      autoresize();
    };
    recognition.onend = () => {
      recording = false;
      btn.classList.remove("rec");
      inputEl.focus();
    };
    recognition.onerror = () => {
      recording = false;
      btn.classList.remove("rec");
    };
    try {
      recognition.start();
      recording = true;
      btn.classList.add("rec");
      buzz(10);
    } catch (_) {}
  };
}

/* ---------- init ---------- */

function init() {
  loadState();
  if (!state.convos.length) newConvo();
  else if (!currentConvo()) state.currentId = state.convos[0].id;
  renderConvoList();
  renderMessages();

  sendBtn.onclick = send;
  inputEl.addEventListener("input", autoresize);
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !("ontouchstart" in window)) {
      e.preventDefault();
      send();
    }
  });

  $("menu-btn").onclick = openDrawer;
  $("drawer-backdrop").onclick = closeDrawer;
  $("new-chat-btn").onclick = () => { newConvo(); closeDrawer(); };

  $("attach-btn").onclick = () => $("file-input").click();
  $("file-input").onchange = (e) => {
    addImages([...e.target.files]);
    e.target.value = "";
  };

  // quick toggles above the composer (mirror the settings, save instantly)
  $("toggle-thinking").onclick = () => {
    state.settings.thinking = !state.settings.thinking;
    saveSettings();
    syncQuickToggles();
    buzz(8);
  };
  $("toggle-websearch").onclick = () => {
    state.settings.webSearch = !state.settings.webSearch;
    saveSettings();
    syncQuickToggles();
    buzz(8);
  };
  $("toggle-firecrawl").onclick = () => {
    state.settings.firecrawl = !state.settings.firecrawl;
    saveSettings();
    syncQuickToggles();
    buzz(8);
  };
  document.querySelectorAll(".effort-seg").forEach((seg) => {
    seg.onclick = () => {
      state.settings.effort = seg.dataset.effort;
      saveSettings();
      syncQuickToggles();
      buzz(8);
    };
  });
  $("toggle-overdrive").onclick = () => {
    setOverdrive(!state.overdrive);
    buzz(state.overdrive ? 25 : 8);
  };
  syncQuickToggles();

  // copy buttons inside rendered markdown (event delegation)
  messagesEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".code-copy");
    if (!btn) return;
    const code = btn.parentElement.querySelector("pre code");
    if (code) {
      copyText(code.textContent);
      btn.textContent = "copied";
      setTimeout(() => (btn.textContent = "copy"), 1200);
    }
  });

  $("settings-btn").onclick = openSettings;
  $("settings-close").onclick = closeSettings;
  $("settings-save").onclick = saveSettingsFromForm;
  $("refresh-models").onclick = () => refreshModels(true);
  $("backend-select").onchange = updateBackendFields;
  $("memory-clear").onclick = () => {
    if (!confirm("Forget everything PocketClaw has learned about you?")) return;
    state.memory = [];
    saveMemory();
    $("memory-edit").value = "";
  };

  // loops
  $("new-loop-btn").onclick = () => openLoopEditor(null);
  $("loop-save").onclick = saveLoopFromForm;
  $("loop-close").onclick = closeLoopEditor;
  $("loop-delete").onclick = deleteLoopFromForm;
  $("loop-run-now").onclick = () => runLoopNow(editingLoopId);
  setInterval(checkLoops, 60000);
  setTimeout(checkLoops, 4000);

  // skills
  $("new-skill-btn").onclick = () => openSkillEditor(null);
  $("skill-save").onclick = saveSkillFromForm;
  $("skill-close").onclick = closeSkillEditor;
  $("skill-delete").onclick = deleteSkillFromForm;

  setupVoice();

  // Probe the gateway: first run served from it → default to the CLI backend;
  // also learn which superpowers (Tandem browser, Firecrawl) it has.
  fetch(gatewayBase() + "/api/health", { headers: gwHeaders() })
    .then((r) => (r.ok ? r.json() : null))
    .then((h) => {
      if (!h || h.backend !== "claude-cli") return;
      state.gatewayTandem = !!h.tandem;
      state.gatewayFirecrawl = !!h.firecrawl;
      if (!localStorage.getItem("pc_settings")) {
        state.settings.backend = "cli";
        saveSettings();
        closeSettings();
      }
      syncQuickToggles();
      renderMessages();
    })
    .catch(() => {});

  // Gentle first-run nudge — re-check at fire time so the gateway health
  // check (which may flip the backend to "cli") wins the race.
  setTimeout(() => {
    if (!backendConfigured()) openSettings();
  }, 900);

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

init();
