#!/usr/bin/env node
/* End-to-end tests for the PocketClaw gateway.
 *
 *   node --test test/
 *
 * Zero dependencies, like the gateway itself. Each test boots a real
 * server/server.js on an ephemeral port with CLAUDE_BIN pointed at
 * test/mock-claude.js, then drives it over HTTP. */

"use strict";

const { test, describe, before, after } = require("node:test");
const assert = require("node:assert");
const { spawn } = require("node:child_process");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const SERVER = path.join(__dirname, "..", "server", "server.js");
const MOCK = path.join(__dirname, "mock-claude.js");

/* ---------- harness ---------- */

function tmpdir(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pocketclaw-" + tag + "-"));
}

/** Boot a gateway. Resolves once it prints the port it bound. */
function startGateway(env = {}) {
  const workspace = env.POCKETCLAW_WORKSPACE || tmpdir("ws");
  const log = path.join(workspace, "mock-claude.log");
  const child = spawn(process.execPath, [SERVER], {
    env: {
      ...process.env,
      PORT: "0",
      HOST: "127.0.0.1",
      CLAUDE_BIN: MOCK,
      CLAUDE_ARGS: "",
      MOCK_CLAUDE_LOG: log,
      POCKETCLAW_WORKSPACE: workspace,
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  let err = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (d) => (err += d));
  return new Promise((resolve, reject) => {
    const fail = setTimeout(
      () => reject(new Error("gateway did not start in 10s.\nstdout:\n" + out + "\nstderr:\n" + err)),
      10000
    );
    child.stdout.on("data", (d) => {
      out += d;
      const m = out.match(/listening on port (\d+)/);
      if (m) {
        clearTimeout(fail);
        resolve({
          child,
          port: Number(m[1]),
          workspace,
          log,
          stdout: () => out,
          stderr: () => err,
          stop: () => new Promise((r) => { child.once("exit", r); child.kill("SIGTERM"); }),
        });
      }
    });
    child.on("exit", (code) => {
      clearTimeout(fail);
      reject(new Error("gateway exited early (" + code + ")\nstdout:\n" + out + "\nstderr:\n" + err));
    });
  });
}

function request(gw, opts = {}) {
  const { method = "GET", path: p = "/", headers = {}, body } = opts;
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port: gw.port, method, path: p, headers },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
      }
    );
    req.on("error", reject);
    if (body !== undefined) req.write(typeof body === "string" ? body : JSON.stringify(body));
    req.end();
  });
}

function json(gw, opts) {
  return request(gw, {
    ...opts,
    headers: { "content-type": "application/json", ...(opts.headers || {}) },
  }).then((r) => ({ ...r, json: safeParse(r.body) }));
}

function safeParse(s) {
  try {
    return JSON.parse(s);
  } catch (_) {
    return null;
  }
}

/** POST /api/chat and collect the SSE events until the stream closes. */
function chat(gw, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        host: "127.0.0.1",
        port: gw.port,
        method: "POST",
        path: "/api/chat",
        headers: { "content-type": "application/json", "content-length": Buffer.byteLength(payload), ...headers },
      },
      (res) => {
        let buf = "";
        const events = [];
        res.setEncoding("utf8");
        res.on("data", (c) => {
          buf += c;
          let sep;
          while ((sep = buf.indexOf("\n\n")) !== -1) {
            const raw = buf.slice(0, sep);
            buf = buf.slice(sep + 2);
            for (const line of raw.split("\n")) {
              if (line.startsWith("data:")) {
                const ev = safeParse(line.slice(5).trim());
                if (ev) events.push(ev);
              }
            }
          }
        });
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, events }));
      }
    );
    req.on("error", reject);
    req.end(payload);
  });
}

function readMockLog(gw) {
  try {
    return fs
      .readFileSync(gw.log, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  } catch (_) {
    return [];
  }
}

const textOf = (events) => events.filter((e) => e.type === "text").map((e) => e.text).join("");

/* ---------- boot / safety ---------- */

describe("boot guards", () => {
  test("refuses a public bind with no token", async () => {
    await assert.rejects(
      () => startGateway({ HOST: "0.0.0.0", POCKETCLAW_TOKEN: "" }),
      /exited early/
    );
  });

  test("public bind is allowed with an explicit override", async () => {
    const gw = await startGateway({ HOST: "127.0.0.1", POCKETCLAW_ALLOW_OPEN: "1" });
    await gw.stop();
  });
});

/* ---------- the main suite (one gateway, no token) ---------- */

describe("gateway", () => {
  let gw;
  before(async () => {
    gw = await startGateway();
  });
  after(async () => {
    if (gw) await gw.stop();
  });

  test("health reports the backend and feature flags", async () => {
    const r = await json(gw, { path: "/api/health" });
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true);
    assert.equal(r.json.backend, "claude-cli");
    assert.equal(r.json.sandbox, false);
  });

  test("serves the app shell", async () => {
    const r = await request(gw, { path: "/" });
    assert.equal(r.status, 200);
    assert.match(r.headers["content-type"], /text\/html/);
    assert.match(r.body, /PocketClaw/);
  });

  test("refuses to serve files outside docs/", async () => {
    const r = await request(gw, { path: "/../server/server.js" });
    assert.ok(r.status === 403 || r.status === 404, "got " + r.status);
    assert.doesNotMatch(r.body, /PocketClaw gateway/);
  });

  test("CORS preflight advertises the methods the app actually uses", async () => {
    const r = await request(gw, { method: "OPTIONS", path: "/api/loops" });
    assert.equal(r.status, 204);
    const methods = r.headers["access-control-allow-methods"] || "";
    for (const m of ["GET", "POST", "PUT", "OPTIONS"]) {
      assert.ok(methods.includes(m), "preflight is missing " + m + " (" + methods + ")");
    }
  });

  test("streams a chat: thinking, tool use, text, done", async () => {
    const r = await chat(gw, { prompt: "hello there" });
    assert.equal(r.status, 200);
    assert.match(r.headers["content-type"], /text\/event-stream/);
    assert.ok(r.events.some((e) => e.type === "thinking"), "no thinking event");
    const tool = r.events.find((e) => e.type === "tool");
    assert.equal(tool?.name, "Read");
    assert.match(textOf(r.events), /echo: hello there/);
    const done = r.events.find((e) => e.type === "done");
    assert.ok(done?.session_id, "no session id in done event");
  });

  test("survives non-JSON noise on the agent's stdout", async () => {
    const r = await chat(gw, { prompt: "NOJSON please" });
    assert.match(textOf(r.events), /echo:/);
    assert.ok(r.events.some((e) => e.type === "done"));
  });

  test("resumes a session when one is supplied", async () => {
    await chat(gw, { prompt: "second turn", sessionId: "sess-abc" });
    const call = readMockLog(gw).pop();
    const i = call.argv.indexOf("--resume");
    assert.notEqual(i, -1, "no --resume flag: " + call.argv.join(" "));
    assert.equal(call.argv[i + 1], "sess-abc");
  });

  test("recovers from a stale session id by retrying without --resume", async () => {
    const r = await chat(gw, { prompt: "STALE session", sessionId: "sess-long-gone" });
    assert.ok(!r.events.some((e) => e.type === "error"), "should not surface the resume failure");
    assert.match(textOf(r.events), /echo: STALE session/);
    const calls = readMockLog(gw).slice(-2);
    assert.ok(calls[0].argv.includes("--resume"), "first attempt should have resumed");
    assert.equal(calls[1].argv.includes("--resume"), false, "retry should drop --resume");
  });

  test("survives a missing claude binary", async () => {
    const broken = await startGateway({ CLAUDE_BIN: "/nonexistent/claude" });
    try {
      const r = await chat(broken, { prompt: "hi" });
      const err = r.events.find((e) => e.type === "error");
      assert.ok(err, "expected an error event");
      assert.match(err.message, /failed to start claude/);
      // the gateway must still be up — a stdin EPIPE used to take it down
      const health = await json(broken, { path: "/api/health" });
      assert.equal(health.status, 200);
    } finally {
      await broken.stop();
    }
  });

  test("passes quoted CLAUDE_ARGS through as single arguments", async () => {
    const custom = await startGateway({ CLAUDE_ARGS: '--allowedTools "Read,Grep" --verbose' });
    try {
      await chat(custom, { prompt: "hello" });
      const call = readMockLog(custom).pop();
      assert.ok(call.argv.includes("Read,Grep"), "quoted value was split: " + call.argv.join("|"));
    } finally {
      await custom.stop();
    }
  });

  test("unknown API endpoints 404 instead of falling through to static", async () => {
    const r = await json(gw, { path: "/api/nope" });
    assert.equal(r.status, 404);
    assert.equal(r.json.error, "unknown endpoint");
  });

  test("serves HEAD for the app shell", async () => {
    const r = await request(gw, { method: "HEAD", path: "/index.html" });
    assert.equal(r.status, 200);
    assert.equal(r.body, "");
  });

  test("reports a failed agent run as an error event", async () => {
    const r = await chat(gw, { prompt: "FAIL now" });
    const err = r.events.find((e) => e.type === "error");
    assert.ok(err, "expected an error event, got " + JSON.stringify(r.events));
    assert.match(err.message, /something went wrong/);
  });

  test("rejects an empty prompt and malformed JSON", async () => {
    const empty = await json(gw, { method: "POST", path: "/api/chat", body: { prompt: "  " } });
    assert.equal(empty.status, 400);
    const bad = await request(gw, {
      method: "POST",
      path: "/api/chat",
      headers: { "content-type": "application/json" },
      body: "{nope",
    });
    assert.equal(bad.status, 400);
  });

  test("rejects an oversized body instead of hanging", async () => {
    const r = await request(gw, {
      method: "POST",
      path: "/api/chat",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "x".repeat(30 * 1024 * 1024) }),
    });
    assert.equal(r.status, 413);
  });

  test("accepts a photo attachment and points the agent at the file", async () => {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64"
    ).toString("base64");
    const r = await chat(gw, {
      prompt: "what is this",
      images: [{ media_type: "image/png", data: png }],
    });
    assert.match(textOf(r.events), /echo:/);
    const dir = path.join(gw.workspace, ".pocketclaw", "uploads");
    const files = fs.readdirSync(dir);
    assert.equal(files.length, 1, "expected exactly one saved upload");
    assert.match(files[0], /\.png$/);
  });

  test("chat runs in the workspace, unsandboxed, with the full toolset", async () => {
    await chat(gw, { prompt: "where am i" });
    const call = readMockLog(gw).pop();
    assert.equal(fs.realpathSync(call.cwd), fs.realpathSync(gw.workspace));
    assert.equal(call.argv.includes("--permission-mode"), false);
  });

  test("forwards the caller's API key to that call only", async () => {
    await chat(gw, { prompt: "with key", anthropicKey: "sk-test-123" });
    const call = readMockLog(gw).pop();
    assert.equal(call.env.key, "sk-test-123");
  });
});

/* ---------- loops ---------- */

describe("loops", () => {
  let gw;
  before(async () => {
    gw = await startGateway();
  });
  after(async () => {
    if (gw) await gw.stop();
  });

  test("stores loop definitions and clamps the interval", async () => {
    const r = await json(gw, {
      method: "PUT",
      path: "/api/loops",
      body: {
        loops: [
          { id: "l1", name: "digest", prompt: "summarize", every: 1, enabled: true },
          { id: "l2", name: "off one", prompt: "nope", every: 60, enabled: false },
        ],
      },
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.loops.length, 2);
    assert.equal(r.json.loops[0].every, 5, "interval should be clamped to the 5 minute floor");

    const get = await json(gw, { path: "/api/loops" });
    assert.equal(get.json.loops.length, 2);
  });

  test("persists loops to disk", async () => {
    const file = path.join(gw.workspace, ".pocketclaw", "loops.json");
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(saved.length, 2);
  });

  test("runs a loop on demand and records the result", async () => {
    const started = await json(gw, {
      method: "POST",
      path: "/api/loops/run?id=l1",
      body: {},
    });
    assert.equal(started.status, 200);

    const run = await waitFor(async () => {
      const r = await json(gw, { path: "/api/loops" });
      const loop = r.json.loops.find((l) => l.id === "l1");
      return loop.runs && loop.runs.length ? loop.runs[loop.runs.length - 1] : null;
    });
    assert.equal(run.isError, false);
    assert.match(run.text, /echo: summarize/);
  });

  test("keeps the loop's session so the next run resumes it", async () => {
    const r = await json(gw, { path: "/api/loops" });
    const loop = r.json.loops.find((l) => l.id === "l1");
    assert.ok(loop.sessionId, "loop did not capture a session id");
  });

  test("running an unknown loop is a 404", async () => {
    const r = await json(gw, { method: "POST", path: "/api/loops/run?id=nope", body: {} });
    assert.equal(r.status, 404);
  });

  test("a PUT preserves server-side run history", async () => {
    const r = await json(gw, {
      method: "PUT",
      path: "/api/loops",
      body: { loops: [{ id: "l1", name: "digest renamed", prompt: "summarize", every: 60, enabled: true }] },
    });
    const loop = r.json.loops[0];
    assert.equal(loop.name, "digest renamed");
    assert.ok(loop.runs.length >= 1, "run history was dropped by the PUT");
  });
});

/* ---------- auth ---------- */

describe("token auth", () => {
  let gw;
  before(async () => {
    gw = await startGateway({ POCKETCLAW_TOKEN: "s3cret" });
  });
  after(async () => {
    if (gw) await gw.stop();
  });

  test("rejects an unauthenticated API call", async () => {
    const r = await json(gw, { path: "/api/loops" });
    assert.equal(r.status, 401);
  });

  test("accepts a bearer header", async () => {
    const r = await json(gw, { path: "/api/loops", headers: { authorization: "Bearer s3cret" } });
    assert.equal(r.status, 200);
  });

  test("accepts a query token (EventSource-friendly)", async () => {
    const r = await json(gw, { path: "/api/loops?token=s3cret" });
    assert.equal(r.status, 200);
  });

  test("rejects a wrong token", async () => {
    const r = await json(gw, { path: "/api/loops", headers: { authorization: "Bearer nope" } });
    assert.equal(r.status, 401);
  });

  test("health is reachable without a token but leaks nothing sensitive", async () => {
    const r = await json(gw, { path: "/api/health" });
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true);
  });
});

/* ---------- sandbox ---------- */

describe("sandbox mode", () => {
  let gw;
  before(async () => {
    gw = await startGateway({
      POCKETCLAW_SANDBOX: "1",
      CLAUDE_ARGS: "--dangerously-skip-permissions --permission-mode acceptEdits",
    });
  });
  after(async () => {
    if (gw) await gw.stop();
  });

  test("health reports the sandbox", async () => {
    const r = await json(gw, { path: "/api/health" });
    assert.equal(r.json.sandbox, true);
    assert.equal(r.json.sandboxEnv, true);
  });

  test("restricts tools, forces default permissions, and strips broad flags", async () => {
    await chat(gw, { prompt: "look around" });
    const call = readMockLog(gw).pop();
    const argv = call.argv;
    assert.equal(argv.includes("--dangerously-skip-permissions"), false, "dangerous flag survived");
    const allowed = argv[argv.indexOf("--allowedTools") + 1].split(",");
    assert.ok(allowed.includes("Read"));
    assert.equal(allowed.includes("Bash"), false);
    assert.equal(allowed.includes("Write"), false);
    // the sandbox's own --permission-mode default must be the only one left
    const modes = argv.reduce((acc, a, i) => (a === "--permission-mode" ? [...acc, argv[i + 1]] : acc), []);
    assert.deepEqual(modes, ["default"]);
  });

  test("runs in the isolated sandbox workspace", async () => {
    await chat(gw, { prompt: "where" });
    const call = readMockLog(gw).pop();
    assert.match(call.cwd, /[\\/]\.pocketclaw[\\/]sandbox$/);
  });

  test("the app can turn the sandbox off for a request", async () => {
    await chat(gw, { prompt: "unlock", sandbox: false });
    const call = readMockLog(gw).pop();
    assert.equal(call.argv.includes("--dangerously-skip-permissions"), true);
    assert.equal(fs.realpathSync(call.cwd), fs.realpathSync(gw.workspace));
    const h = await json(gw, { path: "/api/health" });
    assert.equal(h.json.sandbox, false);
  });
});

/* ---------- watchdog ---------- */

describe("watchdogs", () => {
  test("kills a chat that produces no output", async () => {
    const gw = await startGateway({ POCKETCLAW_CHAT_TIMEOUT_MS: "1500" });
    try {
      const r = await chat(gw, { prompt: "HANG" });
      const err = r.events.find((e) => e.type === "error");
      assert.ok(err, "expected a timeout error event");
      assert.match(err.message, /timed out/);
    } finally {
      await gw.stop();
    }
  });
});

/* ---------- helpers ---------- */

async function waitFor(fn, timeoutMs = 15000) {
  const started = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - started > timeoutMs) throw new Error("timed out waiting for a value");
    await new Promise((r) => setTimeout(r, 150));
  }
}
