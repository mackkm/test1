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
 */

"use strict";

const http = require("http");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 3333);
const HOST = process.env.HOST || "0.0.0.0";
const TOKEN = process.env.POCKETCLAW_TOKEN || "";
const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude";
const WORKSPACE = process.env.POCKETCLAW_WORKSPACE || process.cwd();
const EXTRA_ARGS = (process.env.CLAUDE_ARGS || "").split(" ").filter(Boolean);
const DOCS_DIR = path.join(__dirname, "..", "docs");

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

async function handleChat(req, res) {
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch (e) {
    res.writeHead(400, { "content-type": "application/json" });
    return res.end(JSON.stringify({ error: "invalid JSON body" }));
  }
  const prompt = String(body.prompt || "").trim();
  if (!prompt) {
    res.writeHead(400, { "content-type": "application/json" });
    return res.end(JSON.stringify({ error: "prompt required" }));
  }

  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  const send = (obj) => res.write("data: " + JSON.stringify(obj) + "\n\n");

  const args = ["-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages"];
  if (body.sessionId) args.push("--resume", String(body.sessionId));
  if (body.persona) args.push("--append-system-prompt", String(body.persona).slice(0, 8000));
  args.push(...EXTRA_ARGS);

  console.log(`[chat] ${CLAUDE_BIN} ${args.join(" ")} (prompt: ${prompt.slice(0, 60)}…)`);
  const child = spawn(CLAUDE_BIN, args, {
    cwd: WORKSPACE,
    env: process.env,
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
    return res.end(JSON.stringify({ ok: true, backend: "claude-cli" }));
  }

  if (url.pathname === "/api/chat") {
    if (!authorized(req, url)) {
      res.writeHead(401, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: "unauthorized (bad or missing gateway token)" }));
    }
    if (req.method !== "POST") {
      res.writeHead(405);
      return res.end();
    }
    return handleChat(req, res);
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
  console.log(`\nOn your phone (same network), open http://<this-computer's-IP>:${PORT}`);
});
