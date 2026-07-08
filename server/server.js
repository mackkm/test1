#!/usr/bin/env node
/* PocketClaw gateway — runs Claude Code CLI on this machine and streams the
 * conversation to the PocketClaw app on your phone.
 *
 * Zero dependencies. Start it with:
 *
 *   node server/server.js
 *
 * then open http://<this-computer's-LAN-IP>:3333 on your phone (same Wi-Fi),
 * or put it behind Tailscale/a reverse proxy for access from anywhere.
 *
 * Environment variables:
 *   PORT                  listen port                     (default 3333)
 *   HOST                  bind address                    (default 0.0.0.0)
 *   POCKETCLAW_TOKEN      shared secret; if set, clients must send it
 *   POCKETCLAW_WORKSPACE  working directory for the agent (default: cwd)
 *   POCKETCLAW_SANDBOX    "1" = run the agent restricted by default: isolated
 *                         workspace, only read/research tools, no shell or file
 *                         writes. The app can toggle this per request too.
 *   POCKETCLAW_ALLOW_OPEN "1" = allow starting with no token on a public bind
 *                         (otherwise the gateway refuses; loopback is always ok)
 *   CLAUDE_BIN            path to the claude binary       (default: "claude")
 *   CLAUDE_ARGS           extra args appended to every claude invocation,
 *                         e.g. "--permission-mode acceptEdits" or
 *                         "--allowedTools Read,Grep,WebSearch"
 *   TANDEM_MCP            connect the agent to a Tandem Browser instance
 *                         (https://tandembrowser.org). Either a streamable-http
 *                         URL like "http://localhost:5173/mcp" or a local path
 *                         to Tandem's MCP server.js
 *   TANDEM_MCP_TOKEN      bearer token for remote Tandem connections
 *   FIRECRAWL_API_KEY     enable Firecrawl web tools (search/scrape/interact,
 *                         https://firecrawl.dev) through Firecrawl's hosted MCP
 *   FIRECRAWL_MCP         override/enable the Firecrawl MCP URL explicitly —
 *                         set to https://mcp.firecrawl.dev/v2/mcp for the
 *                         keyless rate-limited tier
 */

"use strict";

const http = require("http");
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const PORT = Number(process.env.PORT || 3333);
const HOST = process.env.HOST || "0.0.0.0";
const TOKEN = process.env.POCKETCLAW_TOKEN || "";
const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude";
const WORKSPACE = process.env.POCKETCLAW_WORKSPACE || process.cwd();
const EXTRA_ARGS = (process.env.CLAUDE_ARGS || "").split(" ").filter(Boolean);
const TANDEM_MCP = process.env.TANDEM_MCP || "";
const TANDEM_MCP_TOKEN = process.env.TANDEM_MCP_TOKEN || "";
const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY || "";
const FIRECRAWL_MCP =
  process.env.FIRECRAWL_MCP ||
  (FIRECRAWL_API_KEY ? "https://mcp.firecrawl.dev/v2/mcp" : "");
const DOCS_DIR = path.join(__dirname, "..", "docs");
// Watchdogs: kill a claude child that stalls, so hung runs can't pile up and
// exhaust a small VM (or silently disable a loop forever).
const CHAT_IDLE_MS = Number(process.env.POCKETCLAW_CHAT_TIMEOUT_MS || 180000);
const LOOP_MAX_MS = Number(process.env.POCKETCLAW_LOOP_TIMEOUT_MS || 600000);
// Refusing to run wide-open: when no token is set we only allow a loopback
// bind unless the operator explicitly opts into an open gateway.
const ALLOW_OPEN = process.env.POCKETCLAW_ALLOW_OPEN === "1";
function isLoopback(h) {
  return h === "127.0.0.1" || h === "localhost" || h === "::1" || h === "::ffff:127.0.0.1";
}

/* MCP superpowers for the agent:
 *  - Tandem Browser (tandembrowser.org) — a real browser it can drive
 *  - Firecrawl (firecrawl.dev) — web search / scrape / interact tools
 *
 * Config comes from two places, merged (client wins): server env vars set at
 * launch, and per-request overrides forwarded by the app so the user can toggle
 * these on from their phone. clientMcp is held in memory only, never on disk,
 * and reused for background loop runs. */
let clientMcp = { tandem: null, firecrawl: null };

/* Sandbox mode: run the agent locked down — in an isolated workspace, with only
 * safe read/research tools (no shell, no file writes, no destructive actions).
 * Default comes from POCKETCLAW_SANDBOX; the app can override per request
 * (client wins, same as the MCP toggles). */
const SANDBOX_ENV = process.env.POCKETCLAW_SANDBOX === "1";
const SANDBOX_DIR = path.join(WORKSPACE, ".pocketclaw", "sandbox");
let clientSandbox = null; // null = follow env; true/false = app override
function sandboxActive() {
  return clientSandbox !== null ? clientSandbox : SANDBOX_ENV;
}
// The only tools the agent may use in sandbox mode. No Bash/Write/Edit/etc., so
// it can read and research but can't modify the machine or run commands.
const SANDBOX_TOOLS = ["Read", "Grep", "Glob", "WebSearch", "WebFetch", "TodoWrite"];
// Strip broad-permission flags an operator may have set, so sandbox can't be
// silently widened by CLAUDE_ARGS.
function safeExtraArgs(args) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--dangerously-skip-permissions" || a === "--bypassPermissions") continue;
    if (a === "--permission-mode" || a === "--allowedTools" || a === "--disallowedTools") {
      i++; // also skip its value
      continue;
    }
    out.push(a);
  }
  return out;
}

function activeMcpServers() {
  const servers = {};

  // Tandem: client override first, then env.
  const tandemUrl = (clientMcp.tandem && clientMcp.tandem.url) || TANDEM_MCP;
  const tandemToken =
    (clientMcp.tandem && clientMcp.tandem.token) || TANDEM_MCP_TOKEN;
  if (clientMcp.tandem !== null ? clientMcp.tandem : TANDEM_MCP) {
    if (tandemUrl && /^https?:\/\//.test(tandemUrl)) {
      servers.tandem = { type: "http", url: tandemUrl };
      if (tandemToken) servers.tandem.headers = { Authorization: "Bearer " + tandemToken };
    } else if (tandemUrl) {
      servers.tandem = { command: "node", args: [tandemUrl] };
    }
  }

  // Firecrawl: client override first, then env.
  const fcKey = (clientMcp.firecrawl && clientMcp.firecrawl.key) || FIRECRAWL_API_KEY;
  const fcUrl =
    (clientMcp.firecrawl && clientMcp.firecrawl.url) ||
    FIRECRAWL_MCP ||
    (fcKey ? "https://mcp.firecrawl.dev/v2/mcp" : "");
  const fcOn = clientMcp.firecrawl !== null ? !!clientMcp.firecrawl : !!FIRECRAWL_MCP;
  if (fcOn && fcUrl) {
    servers.firecrawl = { type: "http", url: fcUrl };
    if (fcKey) servers.firecrawl.headers = { Authorization: "Bearer " + fcKey };
  }

  return servers;
}

function mcpConfig() {
  const servers = activeMcpServers();
  if (!Object.keys(servers).length) return null;
  return {
    json: JSON.stringify({ mcpServers: servers }),
    allowed: Object.keys(servers).map((n) => "mcp__" + n).join(","),
    names: Object.keys(servers),
  };
}

/* Subagents the main agent can delegate to via the Task tool. */
const SUBAGENTS = JSON.stringify({
  researcher: {
    description:
      "Research and information-gathering specialist. Use for web research, reading " +
      "docs, or investigating a codebase. Run several in parallel for independent questions.",
    prompt:
      "You are a focused researcher. Gather exactly the information requested using the " +
      "tools available, verify it, and return a tight structured summary with sources " +
      "or file paths. No fluff.",
  },
  builder: {
    description:
      "Implementation specialist. Use for writing code, files, or scripts once the " +
      "approach is clear.",
    prompt:
      "You are a careful implementer. Write clean, minimal, working code that matches " +
      "the surrounding conventions. Verify your work runs before reporting done.",
  },
  critic: {
    description:
      "Review specialist. Use to double-check important work: review code, fact-check " +
      "a draft, or poke holes in a plan before it ships.",
    prompt:
      "You are a sharp, honest reviewer. Find real problems, rank them by severity, and " +
      "suggest the smallest fix for each. If the work is solid, say so briefly.",
  },
});

/* Standing instructions appended to every run (chat and loops). */
function serverDirectives() {
  const active = activeMcpServers();
  let d =
    "\n\n# Delegation\nYou have subagents (researcher, builder, critic) available via " +
    "the Task tool. Delegate independent or parallelizable subtasks to them and run " +
    "them concurrently when possible; keep working while they run. Do the work " +
    "directly only when it's a quick single-step task.";
  if (active.tandem) {
    d +=
      "\n\n# Browser\nYour default browser is Tandem (the mcp__tandem__* tools). For " +
      "ANY web browsing, page interaction, form filling, or screenshots, use Tandem — " +
      "never launch Chrome, Chromium, or Playwright yourself.";
  }
  if (active.firecrawl) {
    d +=
      "\n\n# Web data\nUse the Firecrawl tools (mcp__firecrawl__*) for web search, " +
      "scraping, and structured extraction when full browser interaction isn't needed.";
  }
  if (sandboxActive()) {
    d +=
      "\n\n# Sandbox mode\nYou are running in a restricted sandbox: only read and " +
      "research tools are available (no shell, no file writes, no destructive " +
      "actions). Stay within your sandbox workspace and do not attempt to modify " +
      "the system or read files outside it. If a task truly needs write/exec access, " +
      "explain that sandbox mode must be turned off rather than trying to work around it.";
  }
  return d;
}

function claudeArgs(extra, opts = {}) {
  const sandbox = !!opts.sandbox;
  const args = ["-p", "--output-format", "stream-json", "--verbose", ...extra];
  args.push("--agents", SUBAGENTS);
  const mcp = mcpConfig();
  if (mcp) args.push("--mcp-config", mcp.json);
  if (sandbox) {
    // Whitelist only the safe tools (plus any MCP browser/web tools that are
    // on), force the default permission mode, and drop broad-permission extras.
    const tools = [...SANDBOX_TOOLS];
    if (mcp) tools.push(...mcp.names.map((n) => "mcp__" + n));
    args.push("--allowedTools", tools.join(","));
    args.push("--permission-mode", "default");
    args.push(...safeExtraArgs(EXTRA_ARGS));
  } else {
    if (mcp) args.push("--allowedTools", mcp.allowed);
    args.push(...EXTRA_ARGS);
  }
  return args;
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".md": "text/markdown; charset=utf-8",
};

function authorized(req, url) {
  if (!TOKEN) return true;
  if (req.headers.authorization === "Bearer " + TOKEN) return true;
  return url.searchParams.get("token") === TOKEN;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 1_000_000) reject(new Error("body too large"));
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

/* ---------- /api/chat: spawn claude, stream SSE back ---------- */

/* Cloud gateways: the app forwards the user's Anthropic API key with each
 * request so the VM never needs a baked-in Claude login. Held in memory only
 * (never written to disk). Chat spawns use the key from THEIR request (never a
 * key another client posted); loops inherit the most recently seen key so they
 * keep working while the phone is away. */
let loopKey = "";

function childEnv(key) {
  return key
    ? { ...process.env, ANTHROPIC_API_KEY: key }
    : process.env;
}

async function handleChat(req, res) {
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch (e) {
    res.writeHead(400, { "content-type": "application/json" });
    return res.end(JSON.stringify({ error: "invalid JSON body" }));
  }
  let prompt = String(body.prompt || "").trim();
  if (!prompt) {
    res.writeHead(400, { "content-type": "application/json" });
    return res.end(JSON.stringify({ error: "prompt required" }));
  }
  // This request's own key — used only for this spawn, never cached globally so
  // one client can't bill/authorize another client's chat. Loops still inherit
  // the latest key so background runs keep working.
  const reqKey = body.anthropicKey ? String(body.anthropicKey) : "";
  if (reqKey) loopKey = reqKey;
  if (body.mcp && typeof body.mcp === "object") {
    // App-forwarded Tandem/Firecrawl config (in-memory only). null = "off",
    // an object = "on with this config"; undefined leaves the current value.
    if ("tandem" in body.mcp) clientMcp.tandem = body.mcp.tandem || null;
    if ("firecrawl" in body.mcp) clientMcp.firecrawl = body.mcp.firecrawl || null;
  }
  if (typeof body.sandbox === "boolean") clientSandbox = body.sandbox;

  // In sandbox mode the agent is confined to an isolated workspace dir.
  const sandbox = sandboxActive();
  const cwd = sandbox ? SANDBOX_DIR : WORKSPACE;
  fs.mkdirSync(cwd, { recursive: true });

  // Photos from the phone: save inside the active workspace so the agent can
  // Read them without a permission prompt (headless mode can't answer prompts).
  const images = Array.isArray(body.images) ? body.images.slice(0, 3) : [];
  if (images.length) {
    const dir = path.join(cwd, ".pocketclaw", "uploads");
    fs.mkdirSync(dir, { recursive: true });
    const saved = [];
    for (let i = 0; i < images.length; i++) {
      const im = images[i] || {};
      const ext = String(im.media_type || "image/jpeg").split("/")[1] || "jpg";
      const file = path.join(dir, `img-${Date.now()}-${i}.${ext.replace(/[^a-z0-9]/gi, "")}`);
      try {
        fs.writeFileSync(file, Buffer.from(String(im.data || ""), "base64"));
        saved.push(file);
      } catch (_) {}
    }
    if (saved.length) {
      prompt +=
        "\n\n[The user attached " + saved.length + " photo(s) from their phone, saved at: " +
        saved.join(", ") + " — use the Read tool to look at them.]";
    }
  }

  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  const send = (obj) => res.write("data: " + JSON.stringify(obj) + "\n\n");

  const extra = ["--include-partial-messages"];
  if (body.sessionId) extra.push("--resume", String(body.sessionId));
  extra.push(
    "--append-system-prompt",
    String(body.persona || "").slice(0, 8000) + serverDirectives()
  );
  const args = claudeArgs(extra, { sandbox });

  console.log(`[chat]${sandbox ? " [sandbox]" : ""} ${CLAUDE_BIN} ${args.join(" ")} (prompt: ${prompt.slice(0, 60)}…)`);
  const child = spawn(CLAUDE_BIN, args, {
    cwd,
    env: childEnv(reqKey),
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdin.write(prompt);
  child.stdin.end();

  let stderr = "";
  let sawDelta = false;
  let sentDone = false;
  let buf = "";
  let timedOut = false;

  // Watchdog: if claude produces no output for CHAT_IDLE_MS (stuck MCP
  // handshake, waiting on stdin, network stall), kill it instead of leaking a
  // process + SSE connection forever. Reset on every stdout chunk.
  let idleTimer = null;
  function stopWatchdog() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
  }
  function armWatchdog() {
    stopWatchdog();
    idleTimer = setTimeout(() => {
      timedOut = true;
      if (!sentDone) send({ type: "error", message: `agent timed out (no output for ${Math.round(CHAT_IDLE_MS / 1000)}s)` });
      try { child.kill("SIGTERM"); } catch (_) {}
      setTimeout(() => { try { child.kill("SIGKILL"); } catch (_) {} }, 5000);
    }, CHAT_IDLE_MS);
  }
  armWatchdog();

  child.stderr.on("data", (d) => (stderr += d));

  child.stdout.on("data", (chunk) => {
    armWatchdog();
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let ev;
      try {
        ev = JSON.parse(line);
      } catch (_) {
        continue;
      }
      handleClaudeEvent(ev);
    }
  });

  function handleClaudeEvent(ev) {
    switch (ev.type) {
      case "stream_event": {
        const e = ev.event || {};
        if (e.type === "content_block_delta") {
          if (e.delta?.type === "text_delta") {
            sawDelta = true;
            send({ type: "text", text: e.delta.text });
          } else if (e.delta?.type === "thinking_delta") {
            send({ type: "thinking", text: e.delta.thinking });
          }
        }
        break;
      }
      case "assistant": {
        for (const block of ev.message?.content || []) {
          if (block.type === "tool_use") {
            let preview = "";
            try {
              preview = JSON.stringify(block.input);
            } catch (_) {}
            if (preview.length > 160) preview = preview.slice(0, 160) + "…";
            send({ type: "tool", name: block.name, preview });
          } else if (block.type === "text" && !sawDelta) {
            // fallback for CLI versions without --include-partial-messages
            send({ type: "text", text: block.text });
          }
        }
        break;
      }
      case "result": {
        sentDone = true;
        send({
          type: "done",
          session_id: ev.session_id,
          is_error: !!ev.is_error,
          cost_usd: ev.total_cost_usd,
        });
        break;
      }
    }
  }

  child.on("close", (code) => {
    stopWatchdog();
    if (!sentDone && !timedOut) {
      send({
        type: "error",
        message:
          "claude exited with code " + code +
          (stderr ? ": " + stderr.trim().slice(-500) : ""),
      });
    }
    res.end();
  });

  child.on("error", (err) => {
    stopWatchdog();
    send({ type: "error", message: "failed to start claude: " + err.message });
    res.end();
  });

  // phone hung up / user tapped stop → stop the agent
  req.on("close", () => {
    stopWatchdog();
    if (child.exitCode === null) child.kill("SIGTERM");
  });
}

/* ---------- loops: scheduled prompts that run even while the phone is away ----------
 * The app syncs loop definitions here (PUT /api/loops); every minute we check
 * which enabled loops are due and run them through the claude CLI. Each loop
 * keeps its own CLI session (--resume), so it remembers previous runs —
 * "summarize new commits since last run" actually works. */

const LOOPS_FILE = path.join(WORKSPACE, ".pocketclaw", "loops.json");
let loops = [];
try {
  loops = JSON.parse(fs.readFileSync(LOOPS_FILE, "utf8"));
} catch (_) {}
const runningLoops = new Set();

function persistLoops() {
  try {
    fs.mkdirSync(path.dirname(LOOPS_FILE), { recursive: true });
    fs.writeFileSync(LOOPS_FILE, JSON.stringify(loops, null, 2));
  } catch (e) {
    console.error("[loops] persist failed:", e.message);
  }
}

function recordLoopRun(loop, text, isError) {
  loop.runs = (loop.runs || []).slice(-19);
  loop.runs.push({ at: Date.now(), text: String(text).slice(0, 20000), isError: !!isError });
  persistLoops();
}

function runLoop(loop) {
  if (runningLoops.has(loop.id)) return;

  // No key available → park the run instead of spawning a doomed child. After a
  // restart the in-memory key is gone, so background loops would otherwise fail
  // every tick until the user reopens the app; record it visibly and bail.
  const key = loopKey || process.env.ANTHROPIC_API_KEY || "";
  if (!key) {
    loop.lastRunAt = Date.now(); // don't hammer every minute
    recordLoopRun(loop, "loop parked — no Anthropic API key available on the gateway. Open the app (or set ANTHROPIC_API_KEY on the server) to resume.", true);
    console.log(`[loop] "${loop.name}" parked (no API key)`);
    return;
  }

  runningLoops.add(loop.id);
  loop.lastRunAt = Date.now(); // set at start so a slow run can't double-fire
  persistLoops();
  console.log(`[loop] running "${loop.name}"`);

  const sandbox = sandboxActive();
  const cwd = sandbox ? SANDBOX_DIR : WORKSPACE;
  fs.mkdirSync(cwd, { recursive: true });
  const extra = loop.sessionId ? ["--resume", loop.sessionId] : [];
  extra.push("--append-system-prompt", serverDirectives());
  const args = claudeArgs(extra, { sandbox });

  const child = spawn(CLAUDE_BIN, args, {
    cwd,
    env: childEnv(loopKey),
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdin.write(loop.prompt);
  child.stdin.end();

  let buf = "";
  let stderr = "";
  let gotResult = false;
  let timedOut = false;

  // Hard cap: a loop child that hangs would keep loop.id in runningLoops
  // forever, so the scheduler would silently skip this loop for the life of the
  // process. Kill it and clear the flag so the loop recovers next tick.
  const killer = setTimeout(() => {
    timedOut = true;
    try { child.kill("SIGTERM"); } catch (_) {}
    setTimeout(() => { try { child.kill("SIGKILL"); } catch (_) {} }, 5000);
  }, LOOP_MAX_MS);

  child.stderr.on("data", (d) => (stderr += d));
  child.stdout.on("data", (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let ev;
      try {
        ev = JSON.parse(line);
      } catch (_) {
        continue;
      }
      if (ev.type === "result") {
        gotResult = true;
        loop.sessionId = ev.session_id || loop.sessionId;
        recordLoopRun(loop, ev.result ?? "", ev.is_error);
      }
    }
  });
  child.on("close", (code) => {
    clearTimeout(killer);
    runningLoops.delete(loop.id);
    if (!gotResult) {
      recordLoopRun(
        loop,
        timedOut
          ? "loop run timed out after " + Math.round(LOOP_MAX_MS / 60000) + " min and was stopped"
          : "loop run failed (exit " + code + ")" + (stderr ? ": " + stderr.trim().slice(-300) : ""),
        true
      );
    }
    console.log(`[loop] "${loop.name}" finished`);
  });
  child.on("error", (err) => {
    clearTimeout(killer);
    runningLoops.delete(loop.id);
    recordLoopRun(loop, "loop spawn error: " + err.message, true);
    console.error(`[loop] "${loop.name}" spawn error:`, err.message);
  });
}

setInterval(() => {
  const now = Date.now();
  for (const loop of loops) {
    if (!loop.enabled || !loop.prompt) continue;
    const every = Math.max(5, Number(loop.every) || 60) * 60000;
    if (!loop.lastRunAt || now - loop.lastRunAt >= every) runLoop(loop);
  }
}, 60000);

async function handleLoops(req, res, url) {
  if (req.method === "GET") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ loops }));
  }
  if (req.method === "PUT") {
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch (_) {
      res.writeHead(400, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: "invalid JSON body" }));
    }
    // Carry over the app's tool config + key so background loops match chat.
    if (body.anthropicKey) loopKey = String(body.anthropicKey);
    if (body.mcp && typeof body.mcp === "object") {
      if ("tandem" in body.mcp) clientMcp.tandem = body.mcp.tandem || null;
      if ("firecrawl" in body.mcp) clientMcp.firecrawl = body.mcp.firecrawl || null;
    }
    if (typeof body.sandbox === "boolean") clientSandbox = body.sandbox;
    const incoming = Array.isArray(body.loops) ? body.loops : [];
    // merge: definitions come from the client; runtime state stays server-side
    loops = incoming.map((inc) => {
      const prev = loops.find((l) => l.id === inc.id) || {};
      return {
        id: String(inc.id),
        name: String(inc.name || "loop").slice(0, 100),
        prompt: String(inc.prompt || "").slice(0, 8000),
        every: Math.max(5, Number(inc.every) || 60),
        enabled: !!inc.enabled,
        sessionId: prev.sessionId,
        lastRunAt: prev.lastRunAt,
        runs: prev.runs || [],
      };
    });
    persistLoops();
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ loops }));
  }
  res.writeHead(405);
  res.end();
}

/* ---------- static file serving (the PWA itself) ---------- */

function serveStatic(pathname, res) {
  let rel = decodeURIComponent(pathname);
  if (rel === "/" || rel === "") rel = "/index.html";
  const file = path.normalize(path.join(DOCS_DIR, rel));
  // Contain to DOCS_DIR: compare with a trailing separator so a sibling dir
  // whose name merely starts with "docs" (e.g. docs-secret) can't slip through.
  if (file !== DOCS_DIR && !file.startsWith(DOCS_DIR + path.sep)) {
    res.writeHead(403);
    return res.end("forbidden");
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end("not found");
    }
    res.writeHead(200, {
      "content-type": MIME[path.extname(file)] || "application/octet-stream",
    });
    res.end(data);
  });
}

/* ---------- server ---------- */

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");

  // CORS (lets a Pages-hosted copy of the app talk to this gateway too)
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "content-type, authorization");
  res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  if (url.pathname === "/api/health") {
    const active = activeMcpServers();
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({
      ok: true,
      backend: "claude-cli",
      // whether each is configurable via server env (informational)
      tandemEnv: !!TANDEM_MCP,
      firecrawlEnv: !!FIRECRAWL_MCP,
      // whether each is currently active (env or app-forwarded)
      tandem: !!active.tandem,
      firecrawl: !!active.firecrawl,
      sandboxEnv: SANDBOX_ENV,
      sandbox: sandboxActive(),
    }));
  }

  if (url.pathname.startsWith("/api/")) {
    if (!authorized(req, url)) {
      res.writeHead(401, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: "unauthorized (bad or missing gateway token)" }));
    }
  }

  if (url.pathname === "/api/chat") {
    if (req.method !== "POST") {
      res.writeHead(405);
      return res.end();
    }
    return handleChat(req, res);
  }

  if (url.pathname === "/api/loops") return handleLoops(req, res, url);

  if (url.pathname === "/api/loops/run") {
    if (req.method !== "POST") {
      res.writeHead(405);
      return res.end();
    }
    const loop = loops.find((l) => l.id === url.searchParams.get("id"));
    if (!loop) {
      res.writeHead(404, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: "loop not found" }));
    }
    runLoop(loop);
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ started: true }));
  }

  if (req.method !== "GET") {
    res.writeHead(405);
    return res.end();
  }
  serveStatic(url.pathname, res);
});

// Never boot an unauthenticated agent onto a public interface. With no token,
// a non-loopback bind is refused unless the operator explicitly opts in.
if (!TOKEN && !isLoopback(HOST) && !ALLOW_OPEN) {
  console.error(
    "\n✋ Refusing to start: no POCKETCLAW_TOKEN is set and HOST=" + HOST +
    " is not loopback.\n" +
    "   This gateway drives an agentic Claude Code process — leaving it open lets\n" +
    "   anyone on the network run it. Fix one of:\n" +
    "     • set POCKETCLAW_TOKEN=<a long random secret>  (recommended)\n" +
    "     • set HOST=127.0.0.1 to bind to this machine only\n" +
    "     • set POCKETCLAW_ALLOW_OPEN=1 to override (only behind your own auth/VPN)\n"
  );
  process.exit(1);
}

server.listen(PORT, HOST, () => {
  console.log(`🦞 PocketClaw gateway`);
  console.log(`   app + API:  http://localhost:${PORT}`);
  console.log(`   workspace:  ${WORKSPACE}`);
  console.log(`   claude:     ${CLAUDE_BIN}${EXTRA_ARGS.length ? " " + EXTRA_ARGS.join(" ") : ""}`);
  console.log(
    TOKEN
      ? `   auth:       token required`
      : isLoopback(HOST)
      ? `   auth:       OPEN — loopback only (set POCKETCLAW_TOKEN to expose it safely)`
      : `   auth:       OPEN — override in effect (POCKETCLAW_ALLOW_OPEN=1) ⚠`
  );
  console.log(`   tandem:     ${TANDEM_MCP ? TANDEM_MCP + " (browser control on)" : "off (set TANDEM_MCP to enable browser control)"}`);
  console.log(`   firecrawl:  ${FIRECRAWL_MCP ? "on" : "off (set FIRECRAWL_API_KEY to enable web tools)"}`);
  console.log(`   sandbox:    ${SANDBOX_ENV ? "ON — restricted tools, isolated workspace" : "off (set POCKETCLAW_SANDBOX=1, or toggle it in the app)"}`);
  console.log(`   loops:      ${loops.length} configured`);
  console.log(`\nOn your phone (same network), open http://<this-computer's-IP>:${PORT}`);
});
