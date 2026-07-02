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
    effort: "",
    maxTokens: 8192,
    gatewayUrl: "",       // empty = same origin as the app
    gatewayToken: "",
  },
  convos: [],          // [{id, title, messages:[{role, content, images?}], updated}]
  currentId: null,
  streaming: false,
  abort: null,
  pendingImages: [],   // [{media_type, data}] queued for the next message
};

const SUGGESTIONS = {
  api: [
    ["🗞️", "What's happening in the news today?"],
    ["✍️", "Help me draft a tricky message"],
    ["💡", "Brainstorm ideas with me"],
    ["🧠", "Teach me something surprising"],
  ],
  cli: [
    ["📁", "Give me a quick tour of this workspace"],
    ["🐛", "Scan the code for potential bugs"],
    ["📜", "Summarize the recent git history"],
    ["🔧", "Help me build something new here"],
  ],
};

function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem("pc_settings"));
    if (s) Object.assign(state.settings, s);
  } catch (_) {}
  try {
    const c = JSON.parse(localStorage.getItem("pc_convos"));
    if (Array.isArray(c)) state.convos = c;
  } catch (_) {}
  state.currentId = localStorage.getItem("pc_current") || null;
}

function saveSettings() {
  localStorage.setItem("pc_settings", JSON.stringify(state.settings));
}
function saveConvos() {
  localStorage.setItem("pc_convos", JSON.stringify(state.convos));
  if (state.currentId) localStorage.setItem("pc_current", state.currentId);
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
  const set = SUGGESTIONS[state.settings.backend] || SUGGESTIONS.api;
  for (const [emoji, text] of set) {
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
        text: s.persona || DEFAULT_PERSONA,
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
  if (s.webSearch) {
    body.tools = [
      { type: searchToolVariant(s.model), name: "web_search", max_uses: 5 },
    ];
  }
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
  const res = await fetch(API_BASE + "/v1/messages", {
    method: "POST",
    headers: apiHeaders(),
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

async function streamChatCli(convo, userText, images, onThinking, onText, onTool, signal) {
  const headers = { "content-type": "application/json" };
  if (state.settings.gatewayToken) {
    headers.authorization = "Bearer " + state.settings.gatewayToken;
  }
  const res = await fetch(gatewayBase() + "/api/chat", {
    method: "POST",
    headers,
    body: JSON.stringify({
      prompt: userText,
      sessionId: convo.cliSessionId || undefined,
      persona: state.settings.persona || undefined,
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
  $("effort-select").value = s.effort;
  $("max-tokens").value = s.maxTokens;
  $("gateway-url").value = s.gatewayUrl;
  $("gateway-token").value = s.gatewayToken;
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
  s.effort = $("effort-select").value;
  s.maxTokens = Number($("max-tokens").value) || 8192;
  s.gatewayUrl = $("gateway-url").value.trim();
  s.gatewayToken = $("gateway-token").value.trim();
  saveSettings();
  closeSettings();
  renderMessages();
}

/* ---------- drawer ---------- */

function openDrawer() {
  renderConvoList();
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

  // First run while served from the PocketClaw gateway → default to the CLI backend.
  if (!localStorage.getItem("pc_settings")) {
    fetch("api/health")
      .then((r) => (r.ok ? r.json() : null))
      .then((h) => {
        if (h && h.backend === "claude-cli") {
          state.settings.backend = "cli";
          saveSettings();
          renderMessages();
          closeSettings();
        }
      })
      .catch(() => {});
  }

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
