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

/* MCP superpowers for the agent:
 *  - Tandem Browser (tandembrowser.org) — a real browser it can drive
 *  - Firecrawl (firecrawl.dev) — web search / scrape / interact tools */
function mcpConfig() {
  const servers = {};
  if (TANDEM_MCP) {
    if (/^https?:\/\//.test(TANDEM_MCP)) {
      servers.tandem = { type: "http", url: TANDEM_MCP };
      if (TANDEM_MCP_TOKEN) {
        servers.tandem.headers = { Authorization: "Bearer " + TANDEM_MCP_TOKEN };
      }
    } else {
      servers.tandem = { command: "node", args: [TANDEM_MCP] };
    }
  }
  if (FIRECRAWL_MCP) {
    servers.firecrawl = { type: "http", url: FIRECRAWL_MCP };
    if (FIRECRAWL_API_KEY) {
      servers.firecrawl.headers = { Authorization: "Bearer " + FIRECRAWL_API_KEY };
    }
  }
  if (!Object.keys(servers).length) return null;
  return {
    json: JSON.stringify({ mcpServers: servers }),
    allowed: Object.keys(servers).map((n) => "mcp__" + n).join(","),
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
  let d =
    "\n\n# Delegation\nYou have subagents (researcher, builder, critic) available via " +
    "the Task tool. Delegate independent or parallelizable subtasks to them and run " +
    "them concurrently when possible; keep working while they run. Do the work " +
    "directly only when it's a quick single-step task.";
  if (TANDEM_MCP) {
    d +=
      "\n\n# Browser\nYour default browser is Tandem (the mcp__tandem__* tools). For " +
      "ANY web browsing, page interaction, form filling, or screenshots, use Tandem — " +
      "never launch Chrome, Chromium, or Playwright yourself.";
  }
  if (FIRECRAWL_MCP) {
    d +=
      "\n\n# Web data\nUse the Firecrawl tools (mcp__firecrawl__*) for web search, " +
      "scraping, and structured extraction when full browser interaction isn't needed.";
  }
  return d;
}

function claudeArgs(extra) {
  const args = ["-p", "--output-format", "stream-json", "--verbose", ...extra];
  args.push("--agents", SUBAGENTS);
  const mcp = mcpConfig();
  if (mcp) args.push("--mcp-config", mcp.json, "--allowedTools", mcp.allowed);
  args.push(...EXTRA_ARGS);
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
 * (never written to disk); reused for background loop runs. */
let clientAnthropicKey = "";

function childEnv() {
  return clientAnthropicKey
    ? { ...process.env, ANTHROPIC_API_KEY: clientAnthropicKey }
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
  if (body.anthropicKey) clientAnthropicKey = String(body.anthropicKey);

  // Photos from the phone: save inside the workspace so the agent can Read
  // them without a permission prompt (headless mode can't answer prompts).
  const images = Array.isArray(body.images) ? body.images.slice(0, 3) : [];
  if (images.length) {
    const dir = path.join(WORKSPACE, ".pocketclaw", "uploads");
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
  const args = claudeArgs(extra);

  console.log(`[chat] ${CLAUDE_BIN} ${args.join(" ")} (prompt: ${prompt.slice(0, 60)}…)`);
  const child = spawn(CLAUDE_BIN, args, {
    cwd: WORKSPACE,
    env: childEnv(),
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdin.write(prompt);
  child.stdin.end();

  let stderr = "";
  let sawDelta = false;
  let sentDone = false;
  let buf = "";

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
    if (!sentDone) {
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
    send({ type: "error", message: "failed to start claude: " + err.message });
    res.end();
  });

  // phone hung up / user tapped stop → stop the agent
  req.on("close", () => {
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

function runLoop(loop) {
  if (runningLoops.has(loop.id)) return;
  runningLoops.add(loop.id);
  loop.lastRunAt = Date.now(); // set at start so a slow run can't double-fire
  persistLoops();
  console.log(`[loop] running "${loop.name}"`);

  const extra = loop.sessionId ? ["--resume", loop.sessionId] : [];
  extra.push("--append-system-prompt", serverDirectives());
  const args = claudeArgs(extra);

  const child = spawn(CLAUDE_BIN, args, {
    cwd: WORKSPACE,
    env: childEnv(),
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdin.write(loop.prompt);
  child.stdin.end();

  let buf = "";
  let stderr = "";
  let gotResult = false;
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
        loop.runs = (loop.runs || []).slice(-19);
        loop.runs.push({
          at: Date.now(),
          text: String(ev.result ?? "").slice(0, 20000),
          isError: !!ev.is_error,
        });
        persistLoops();
      }
    }
  });
  child.on("close", (code) => {
    runningLoops.delete(loop.id);
    if (!gotResult) {
      loop.runs = (loop.runs || []).slice(-19);
      loop.runs.push({
        at: Date.now(),
        text: "loop run failed (exit " + code + ")" +
          (stderr ? ": " + stderr.trim().slice(-300) : ""),
        isError: true,
      });
      persistLoops();
    }
    console.log(`[loop] "${loop.name}" finished`);
  });
  child.on("error", (err) => {
    runningLoops.delete(loop.id);
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
  if (!file.startsWith(DOCS_DIR)) {
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
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({
      ok: true,
      backend: "claude-cli",
      tandem: !!TANDEM_MCP,
      firecrawl: !!FIRECRAWL_MCP,
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

server.listen(PORT, HOST, () => {
  console.log(`🦞 PocketClaw gateway`);
  console.log(`   app + API:  http://localhost:${PORT}`);
  console.log(`   workspace:  ${WORKSPACE}`);
  console.log(`   claude:     ${CLAUDE_BIN}${EXTRA_ARGS.length ? " " + EXTRA_ARGS.join(" ") : ""}`);
  console.log(TOKEN ? `   auth:       token required` : `   auth:       OPEN (set POCKETCLAW_TOKEN to protect it)`);
  console.log(`   tandem:     ${TANDEM_MCP ? TANDEM_MCP + " (browser control on)" : "off (set TANDEM_MCP to enable browser control)"}`);
  console.log(`   firecrawl:  ${FIRECRAWL_MCP ? "on" : "off (set FIRECRAWL_API_KEY to enable web tools)"}`);
  console.log(`   loops:      ${loops.length} configured`);
  console.log(`\nOn your phone (same network), open http://<this-computer's-IP>:${PORT}`);
});
