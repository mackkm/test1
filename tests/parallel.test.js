"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const http = require("node:http");
const os = require("node:os");
const { spawn } = require("node:child_process");
const { once } = require("node:events");

const root = path.join(__dirname, "..");
const gatewaySource = fs.readFileSync(path.join(root, "server/server.js"), "utf8");
const appSource = fs.readFileSync(path.join(root, "docs/app.js"), "utf8");

// Load the real resolver/argument builder without starting the HTTP listener.
function gateway(env = {}, files = {}) {
  const context = vm.createContext({
    __dirname: path.join(root, "server"),
    process: { env: { POCKETCLAW_WORKSPACE: "/workspace", ...env }, cwd: () => "/workspace" },
    require(name) {
      if (name === "fs") return { readFileSync(file) {
        if (Object.hasOwn(files, file)) return JSON.stringify(files[file]);
        throw Object.assign(new Error("missing"), { code: "ENOENT" });
      } };
      if (name === "os") return { homedir: () => "/test-home" };
      return require(name);
    },
  });
  vm.runInContext(gatewaySource.slice(0, gatewaySource.indexOf("const MIME =")), context);
  return {
    servers: () => JSON.parse(vm.runInContext("JSON.stringify(activeMcpServers())", context)),
    args: (sandbox = false) => Array.from(vm.runInContext(`claudeArgs([], {sandbox:${sandbox}})`, context)),
    set: (value) => vm.runInContext(`clientMcp = ${JSON.stringify({ tandem: null, firecrawl: null, parallel: null, ...value })}`, context),
    directives: () => vm.runInContext("serverDirectives()", context),
  };
}

test("fresh gateway supplies anonymous HTTP MCP with project identification", () => {
  const g = gateway();
  assert.deepEqual(g.servers().parallel, {
    type: "http", url: "https://search.parallel.ai/mcp",
    headers: { "User-Agent": "PocketClaw/1.0 (+https://github.com/mackkm/test1)" },
  });
  const args = g.args();
  assert.deepEqual(JSON.parse(args[args.indexOf("--mcp-config") + 1]).mcpServers, g.servers());
  assert.equal(args[args.indexOf("--allowedTools") + 1], "mcp__parallel");
  assert.match(g.directives(), /mcp__parallel__web_search/);
  assert.match(g.directives(), /do not silently switch providers/);
});

test("configured providers and custom CLI arguments suppress auto", () => {
  for (const env of [
    { FIRECRAWL_API_KEY: "configured-key" },
    { FIRECRAWL_MCP: "https://custom.example/mcp" },
    { CLAUDE_ARGS: "--disallowedTools WebSearch" },
    { CLAUDE_ARGS: "--mcp-config custom.json" },
    { POCKETCLAW_PARALLEL: "off" },
    { POCKETCLAW_PARALLEL: "invalid" },
  ]) assert.equal(gateway(env).servers().parallel, undefined);
  assert.equal(gateway({ FIRECRAWL_API_KEY: "configured-key" }).servers().firecrawl.headers.Authorization, "Bearer configured-key");
});

test("saved MCP or permissions suppress auto without changing saved files", () => {
  for (const files of [
    { "/test-home/.claude/settings.json": { disabledMcpjsonServers: ["parallel"] } },
    { "/workspace/.mcp.json": { mcpServers: { custom: { type: "http", url: "https://custom.example/mcp" } } } },
    { "/test-home/.claude/settings.json": { permissions: { deny: ["WebSearch"] } } },
    { "/workspace/.claude/settings.local.json": { permissions: { allow: ["Read"] } } },
    { "/test-home/.claude.json": { projects: { "/workspace": { mcpServers: { custom: {} } } } } },
  ]) assert.equal(gateway({}, files).servers().parallel, undefined);
  assert.ok(gateway({}, { "/test-home/.claude.json": { hasCompletedOnboarding: true } }).servers().parallel);
});

test("explicit app on/off wins; auto restores environment resolution", () => {
  const g = gateway({ POCKETCLAW_PARALLEL: "off", TANDEM_MCP: "https://browser.example/mcp" });
  g.set({ parallel: true });
  assert.ok(g.servers().parallel);
  assert.equal(g.servers().tandem.url, "https://browser.example/mcp");
  g.set({ parallel: false });
  assert.equal(g.servers().parallel, undefined);
  g.set({ parallel: null });
  assert.equal(g.servers().parallel, undefined);
  const on = gateway({ POCKETCLAW_PARALLEL: "on" });
  on.set({ parallel: false });
  assert.equal(on.servers().parallel, undefined);
});

test("sandbox allows research tools without broadening shell access", () => {
  const args = gateway().args(true);
  const allowed = args[args.indexOf("--allowedTools") + 1].split(",");
  assert.ok(allowed.includes("mcp__parallel"));
  assert.ok(!allowed.includes("Bash"));
  assert.ok(!allowed.includes("Write"));
  for (const sandbox of [false, true]) {
    const restricted = gateway({ POCKETCLAW_PARALLEL: "on", CLAUDE_ARGS: "--disallowedTools mcp__parallel__web_fetch" }).args(sandbox);
    assert.equal(restricted[restricted.indexOf("--disallowedTools") + 1], "mcp__parallel__web_fetch");
  }
});

test("new app uses auto; saved app choices migrate to off and round trip", () => {
  // Extract whole named functions with balanced braces by using known neighbors.
  const storage = appSource.slice(appSource.indexOf("function loadState()"), appSource.indexOf("// localStorage has"));
  const config = appSource.slice(appSource.indexOf("function gwMcpConfig()"), appSource.indexOf("async function streamChatCli"));
  for (const [saved, expected] of [[null, null], [{ cliFirecrawl: true }, false], [{ cliParallel: "on" }, true], [{ cliParallel: "off" }, false], [{ cliParallel: "auto" }, null]]) {
    const c = vm.createContext({ state: { settings: { cliParallel: "auto" } }, localStorage: { getItem: (key) => key === "pc_settings" ? JSON.stringify(saved) : null }, defaultSkills: () => [] });
    vm.runInContext(storage + config + "loadState()", c);
    assert.equal(vm.runInContext("gwMcpConfig().parallel", c), expected);
  }
});


test("cancelling a streamed research request terminates its agent", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pocketclaw-cancel-"));
  const signalFile = path.join(dir, "stopped");
  const cli = path.join(dir, "claude");
  fs.writeFileSync(cli, `#!/usr/bin/env node
const fs = require("node:fs");
process.stdin.resume();
process.stdin.on("end", () => {
  console.log(JSON.stringify({type:"assistant",message:{content:[{type:"tool_use",name:"mcp__parallel__web_search",input:{objective:"research"}}]}}));
});
process.on("SIGTERM", () => { fs.writeFileSync(${JSON.stringify(signalFile)}, "stopped"); process.exit(0); });
setInterval(() => {}, 1000);
`);
  fs.chmodSync(cli, 0o755);
  const listener = http.createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  const child = spawn(process.execPath, [path.join(root, "server/server.js")], {
    env: { PATH: process.env.PATH, HOST: "127.0.0.1", PORT: String(port),
      POCKETCLAW_WORKSPACE: dir, CLAUDE_BIN: cli, POCKETCLAW_PARALLEL: "on" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(async () => {
    child.kill("SIGTERM");
    if (child.exitCode === null) await once(child, "exit");
    fs.rmSync(dir, { recursive: true, force: true });
  });
  await once(child.stdout, "data");
  const abort = new AbortController();
  const response = await fetch(`http://127.0.0.1:${port}/api/chat`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: "Research a topic" }), signal: abort.signal,
  });
  const reader = response.body.getReader();
  assert.match(new TextDecoder().decode((await reader.read()).value), /mcp__parallel__web_search/);
  abort.abort();
  const until = Date.now() + 2000;
  while (!fs.existsSync(signalFile) && Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(fs.readFileSync(signalFile, "utf8"), "stopped");
});
