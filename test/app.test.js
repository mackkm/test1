#!/usr/bin/env node
/* Tests for the PWA's pure logic — request building, markdown, storage.
 *
 *   node --test test/app.test.js
 *
 * docs/app.js is plain browser script, so it runs here inside a `vm` context
 * with just enough DOM to boot. Lexical declarations stay in that context, so
 * `evalIn(ctx, "buildRequestBody(convo)")` can reach them directly. */

"use strict";

const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const APP = fs.readFileSync(path.join(__dirname, "..", "docs", "app.js"), "utf8");

/* ---------- the smallest DOM the app will boot on ---------- */

function fakeElement() {
  const el = {
    value: "",
    checked: false,
    textContent: "",
    innerHTML: "",
    disabled: false,
    style: {},
    dataset: {},
    offsetParent: null,
    firstChild: { textContent: "" },
    lastChild: { textContent: "" },
    classList: {
      _set: new Set(),
      add(c) { this._set.add(c); },
      remove(c) { this._set.delete(c); },
      toggle(c, on) { if (on === undefined) on = !this._set.has(c); on ? this._set.add(c) : this._set.delete(c); },
      contains(c) { return this._set.has(c); },
    },
    appendChild(child) { (el.children ||= []).push(child); return child; },
    insertBefore(child) { (el.children ||= []).push(child); return child; },
    removeChild() {},
    remove() {},
    querySelector() { return fakeElement(); },
    querySelectorAll() { return []; },
    addEventListener() {},
    removeEventListener() {},
    setAttribute() {},
    getAttribute() { return null; },
    focus() {},
    select() {},
    closest() { return null; },
    get parentElement() { return fakeElement(); },
  };
  return el;
}

function makeStorage() {
  const map = new Map();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

function boot(seed = {}) {
  const localStorage = makeStorage();
  for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, JSON.stringify(v));

  const elements = new Map();
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, fakeElement());
      return elements.get(id);
    },
    createElement: () => fakeElement(),
    querySelectorAll: () => [],
    addEventListener() {},
    body: fakeElement(),
    documentElement: { style: { setProperty() {} } },
    get activeElement() { return null; },
  };

  const ctx = vm.createContext({
    document,
    localStorage,
    location: { origin: "https://example.test" },
    navigator: { language: "en-US", vibrate() {}, clipboard: null },
    window: {},
    console,
    setTimeout: () => 0,
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    requestAnimationFrame: () => 0,
    fetch: () => Promise.reject(new Error("offline in tests")),
    AbortController: class { constructor() { this.signal = {}; } abort() {} },
    alert() {},
    confirm: () => true,
    Image: class {},
    URL,
    TextDecoder,
  });
  ctx.window = ctx;
  ctx.self = ctx;
  vm.runInContext(APP, ctx, { filename: "app.js" });
  return { ctx, localStorage, elements };
}

const evalIn = (ctx, expr) => vm.runInContext(expr, ctx);

/** Build a request body for one model/settings combination. */
function bodyFor(ctx, settings) {
  evalIn(ctx, `Object.assign(state.settings, ${JSON.stringify(settings)})`);
  return evalIn(
    ctx,
    'buildRequestBody({ messages: [{ role: "user", content: "hi" }] })'
  );
}

/* ---------- request construction ---------- */

describe("request body", () => {
  let ctx;
  beforeEach(() => {
    ctx = boot().ctx;
  });

  test("defaults to Claude Opus 5", () => {
    assert.equal(evalIn(ctx, "DEFAULT_MODEL"), "claude-opus-5");
    assert.equal(evalIn(ctx, "state.settings.model"), "claude-opus-5");
  });

  test("asks for summarized thinking and passes effort through", () => {
    const body = bodyFor(ctx, { model: "claude-opus-5", thinking: true, effort: "xhigh" });
    assert.deepEqual(body.thinking, { type: "adaptive", display: "summarized" });
    assert.deepEqual(body.output_config, { effort: "xhigh" });
  });

  test("disables thinking only where the model accepts it", () => {
    const low = bodyFor(ctx, { model: "claude-opus-5", thinking: false, effort: "medium" });
    assert.deepEqual(low.thinking, { type: "disabled" });

    // Opus 5 rejects disabled thinking above "high" effort — omit it instead
    for (const effort of ["xhigh", "max"]) {
      const body = bodyFor(ctx, { model: "claude-opus-5", thinking: false, effort });
      assert.equal(body.thinking, undefined, `thinking must be omitted at effort ${effort}`);
    }

    // Fable/Mythos reject it at any effort — thinking is always on there
    const fable = bodyFor(ctx, { model: "claude-fable-5", thinking: false, effort: "" });
    assert.equal(fable.thinking, undefined);
  });

  test("adds a refusal fallback for Fable", () => {
    const fable = bodyFor(ctx, { model: "claude-fable-5", thinking: true, effort: "max" });
    assert.deepEqual(fable.fallbacks, [{ model: "claude-opus-4-8" }]);

    const opus = bodyFor(ctx, { model: "claude-opus-5", thinking: true, effort: "" });
    assert.equal(opus.fallbacks, undefined);
  });

  test("sends no thinking or effort fields to models that reject them", () => {
    const body = bodyFor(ctx, { model: "claude-haiku-4-5", thinking: true, effort: "max" });
    assert.equal(body.thinking, undefined);
    assert.equal(body.output_config, undefined);
  });

  test("picks the web search tool version the model supports", () => {
    assert.equal(evalIn(ctx, 'searchToolVariant("claude-opus-5")'), "web_search_20260209");
    assert.equal(evalIn(ctx, 'searchToolVariant("claude-sonnet-5")'), "web_search_20260209");
    assert.equal(evalIn(ctx, 'searchToolVariant("claude-haiku-4-5")'), "web_search_20250305");
  });

  test("wires Firecrawl up as an MCP toolset, not a bare server", () => {
    const body = bodyFor(ctx, { model: "claude-opus-5", firecrawl: true, firecrawlKey: "fc-x" });
    assert.equal(body.mcp_servers[0].name, "firecrawl");
    assert.ok(
      body.tools.some((t) => t.type === "mcp_toolset" && t.mcp_server_name === "firecrawl"),
      "an mcp_toolset entry is required alongside mcp_servers"
    );
  });

  test("clamps max_tokens into the supported range", () => {
    assert.equal(bodyFor(ctx, { maxTokens: 10 }).max_tokens, 256);
    assert.equal(bodyFor(ctx, { maxTokens: 999999 }).max_tokens, 64000);
  });
});

/* ---------- markdown ---------- */

describe("markdown", () => {
  let ctx;
  beforeEach(() => {
    ctx = boot().ctx;
  });

  const md = (s) => evalIn(ctx, `renderMarkdown(${JSON.stringify(s)})`);

  test("escapes HTML", () => {
    const out = md('<img src=x onerror="alert(1)">');
    assert.doesNotMatch(out, /<img/);
    assert.match(out, /&lt;img/);
  });

  test("does not re-parse markdown inside code spans", () => {
    const out = md("use `**not bold**` here");
    assert.match(out, /<code>\*\*not bold\*\*<\/code>/);
    assert.doesNotMatch(out, /<code>.*<strong>/);
  });

  test("still formats emphasis, links and code fences", () => {
    assert.match(md("**bold**"), /<strong>bold<\/strong>/);
    assert.match(md("[x](https://e.test)"), /<a href="https:\/\/e.test"/);
    assert.match(md("```js\nlet a = 1;\n```"), /<pre><code>let a = 1;/);
  });

  test("renders tables", () => {
    const out = md("| a | b |\n| - | - |\n| 1 | 2 |");
    assert.match(out, /<table>/);
    assert.match(out, /<th>a<\/th>/);
    assert.match(out, /<td>2<\/td>/);
  });
});

/* ---------- persistence ---------- */

describe("storage", () => {
  test("Overdrive survives a reload and can still be undone", () => {
    const first = boot();
    evalIn(first.ctx, 'Object.assign(state.settings, {model: "claude-sonnet-5", effort: "low", maxTokens: 4096})');
    evalIn(first.ctx, "setOverdrive(true)");
    assert.equal(evalIn(first.ctx, "state.settings.model"), "claude-fable-5");

    // reload with whatever was persisted
    const saved = JSON.parse(first.localStorage.getItem("pc_settings"));
    const second = boot({ pc_settings: saved });
    assert.equal(evalIn(second.ctx, "state.overdrive"), true, "Overdrive state was lost");

    evalIn(second.ctx, "setOverdrive(false)");
    assert.equal(evalIn(second.ctx, "state.settings.model"), "claude-sonnet-5");
    assert.equal(evalIn(second.ctx, "state.settings.effort"), "low");
    assert.equal(evalIn(second.ctx, "state.settings.maxTokens"), 4096);
  });

  test("ignores corrupt stored values instead of failing to start", () => {
    const { ctx, localStorage } = boot();
    localStorage.setItem("pc_convos", "{not json");
    localStorage.setItem("pc_loops", '"a string"');
    evalIn(ctx, "loadState()");
    assert.ok(Array.isArray(evalIn(ctx, "state.convos")));
    assert.deepEqual(evalIn(ctx, "state.loops"), []);
  });

  test("frees space by dropping stored images before whole conversations", () => {
    const { ctx } = boot();
    evalIn(
      ctx,
      `state.convos = [
         { id: "old", messages: [{ role: "user", content: "x", images: [{ media_type: "image/jpeg", data: "AAAA" }] }] },
         { id: "cur", messages: [{ role: "user", content: "y", images: [{ media_type: "image/jpeg", data: "BBBB" }] }] },
       ];
       state.currentId = "cur";
       evictForSpace();`
    );
    assert.deepEqual(evalIn(ctx, "state.convos[0].messages[0].images"), [], "older images should be dropped");
    assert.equal(evalIn(ctx, "state.convos.find((c) => c.id === 'cur').messages[0].images.length"), 1);
  });
});
