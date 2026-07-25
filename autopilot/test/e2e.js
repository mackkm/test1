#!/usr/bin/env node
/* End-to-end test suite for the Campaign Shorts Autopilot.
 *
 *   node test/e2e.js            # run everything
 *   node test/e2e.js render     # run only sections matching "render"
 *
 * Zero dependencies, like the rest of the project. Nothing here touches the
 * public internet: external APIs (Claude, Whop, socials) are stubbed, and the
 * HTTP client is exercised against a throwaway localhost server. What is NOT
 * stubbed is the part that actually has to work on the VM — ffmpeg, the TTS
 * engine, caption timing, the orchestrator, and the journal — so a green run
 * here means the pipeline genuinely renders and cycles end to end.
 *
 * Requires: ffmpeg/ffprobe and espeak-ng (or PIPER_BIN + PIPER_VOICE). */

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { spawn, spawnSync } = require("child_process");

/* Every lib module reads its config at load time, so the data dir must be
 * pointed at a scratch directory before anything under lib/ is required. */
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "autopilot-e2e-"));
process.env.AUTOPILOT_DATA = path.join(TMP, "data");
const ASSETS = path.join(TMP, "assets");
const LIB = (rel) => require.resolve(path.join(__dirname, "..", rel));

/* ------------------------------- harness -------------------------------- */

const only = process.argv[2] || "";
let passed = 0;
const failures = [];
let section = "";

function describe(name) {
  section = name;
  if (!only || name.toLowerCase().includes(only.toLowerCase())) console.log(`\n${name}`);
}
async function it(name, fn) {
  if (only && !section.toLowerCase().includes(only.toLowerCase())) return;
  try {
    await fn();
    passed++;
    console.log(`  ✔ ${name}`);
  } catch (e) {
    failures.push({ section, name, error: e });
    console.log(`  ✖ ${name}\n      ${e.message.split("\n")[0]}`);
  }
}
function ok(v, msg) {
  if (!v) throw new Error(msg || `expected truthy, got ${JSON.stringify(v)}`);
}
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${msg ? msg + ": " : ""}expected ${b}, got ${a}`);
}
function near(actual, expected, tol, msg) {
  if (!(Math.abs(actual - expected) <= tol))
    throw new Error(`${msg ? msg + ": " : ""}expected ${expected}±${tol}, got ${actual}`);
}
async function throws(fn, match, msg) {
  try {
    await fn();
  } catch (e) {
    if (match && !String(e.message).includes(match))
      throw new Error(`${msg || "threw wrong error"}: expected /${match}/, got "${e.message}"`);
    return;
  }
  throw new Error(msg || "expected it to throw, but it resolved");
}

/* Replace a module in the require cache with a stub (and restore later). */
function mock(rel, exports) {
  const p = LIB(rel);
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
}
function unmock(rel) {
  delete require.cache[LIB(rel)];
}
/* Re-require a module with fresh env applied at its load time. */
function reload(rel, env = {}) {
  const prev = {};
  for (const [k, v] of Object.entries(env)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  delete require.cache[LIB(rel)];
  const mod = require(LIB(rel));
  mod.__restoreEnv = () => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
  return mod;
}

const ff = (args) => spawnSync("ffmpeg", args, { encoding: "utf8" });
const probe = (file, entries) =>
  spawnSync("ffprobe", ["-v", "error", "-show_entries", entries, "-of", "csv=p=0", file], {
    encoding: "utf8",
  }).stdout.trim();

/* --------------------------- test fixtures ------------------------------ */

function buildAssets() {
  for (const d of ["backgrounds", "music", "vid/backgrounds", "vid/music"])
    fs.mkdirSync(path.join(ASSETS, d), { recursive: true });
  ff(["-y", "-v", "error", "-f", "lavfi", "-i", "gradients=s=1080x1920:c0=0x203040:c1=0x802020:n=2",
      "-frames:v", "1", path.join(ASSETS, "backgrounds", "still.png")]);
  ff(["-y", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=220:duration=20",
      "-c:a", "pcm_s16le", path.join(ASSETS, "music", "bed.wav")]);
  ff(["-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=s=540x960:duration=4:rate=25",
      "-pix_fmt", "yuv420p", path.join(ASSETS, "vid", "backgrounds", "clip.mp4")]);
  fs.copyFileSync(path.join(ASSETS, "music", "bed.wav"), path.join(ASSETS, "vid", "music", "bed.wav"));
}

/* A script object shaped exactly like what lib/script.js returns. */
const SCRIPT = {
  title: "Three solar gadgets that pay for themselves",
  lines: [
    "These three gadgets pay for themselves.",
    "The first one charges your phone for free.",
    "The second lights your whole yard at night.",
    "This video is a paid partnership with SolarCo.",
    "Follow for more money saving tech.",
  ],
  caption: "Three solar gadgets worth buying. Follow for more.",
  hashtags: ["solar", "gadgets"],
  whop_post: { title: "New short is live", content: "Just posted a breakdown of three solar gadgets." },
};

/* ================================ TESTS ================================== */

async function main() {
  console.log(`autopilot e2e — scratch dir ${TMP}`);

  /* --------------------------- lib/http.js ----------------------------- */
  describe("http client");
  {
    const { form, requestJSON, requestFollow } = require(LIB("lib/http.js"));

    await it("form() encodes and drops null/undefined", () => {
      eq(form({ a: "x y", b: null, c: undefined, d: 2 }), "a=x%20y&d=2");
    });

    // A real server on loopback: exercises the client without any egress.
    const seen = [];
    const server = http.createServer((req, res) => {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        seen.push({ url: req.url, method: req.method, body: Buffer.concat(chunks).toString() });
        if (req.url === "/json") {
          res.writeHead(200, { "content-type": "application/json" });
          return res.end(JSON.stringify({ hello: "world" }));
        }
        if (req.url === "/redirect") {
          res.writeHead(302, { location: "/json" });
          return res.end();
        }
        if (req.url === "/see-other") {
          res.writeHead(303, { location: "/json" });
          return res.end();
        }
        if (req.url === "/boom") {
          res.writeHead(422, { "content-type": "application/json" });
          return res.end(JSON.stringify({ error: "nope" }));
        }
        res.writeHead(404);
        res.end("nope");
      });
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${server.address().port}`;

    await it("requestJSON parses a JSON body", async () => {
      eq(await requestJSON(`${base}/json`), { hello: "world" });
    });
    await it("requestJSON posts a JSON body with content-type", async () => {
      seen.length = 0;
      await requestJSON(`${base}/json`, { method: "POST", body: { a: 1 } });
      eq(seen[0].body, JSON.stringify({ a: 1 }));
    });
    await it("throws on >=400 with status and parsed json attached", async () => {
      try {
        await requestJSON(`${base}/boom`);
        throw new Error("should have thrown");
      } catch (e) {
        eq(e.status, 422);
        eq(e.json, { error: "nope" });
      }
    });
    await it("follows redirects", async () => {
      eq(await requestJSON(`${base}/redirect`), { hello: "world" });
    });
    await it("303 after POST switches to GET and drops the body", async () => {
      seen.length = 0;
      await requestJSON(`${base}/see-other`, { method: "POST", body: { a: 1 } });
      const final = seen[seen.length - 1];
      eq(final.method, "GET", "method after 303");
      eq(final.body, "", "body after 303");
    });
    await it("surfaces a timeout rather than hanging", async () => {
      const slow = http.createServer(() => {}); // never responds
      await new Promise((r) => slow.listen(0, "127.0.0.1", r));
      await throws(
        () => requestFollow(`http://127.0.0.1:${slow.address().port}/`, { timeoutMs: 300 }),
        "timeout"
      );
      slow.close();
    });
    server.close();
  }

  /* --------------------------- lib/state.js ---------------------------- */
  describe("state + journal");
  {
    const state = require(LIB("lib/state.js"));
    await it("ensure() creates the data layout", () => {
      state.ensure();
      ok(fs.existsSync(path.join(state.DATA_DIR, "out")), "out/ missing");
      ok(fs.existsSync(path.join(state.DATA_DIR, "tmp")), "tmp/ missing");
    });
    await it("journal appends and reads back newest-last", () => {
      state.journal({ id: "a", topic: "One" });
      state.journal({ id: "b", topic: "Two" });
      const j = state.readJournal(10);
      eq(j.map((e) => e.topic), ["One", "Two"]);
      ok(j[0].ts, "entries are timestamped");
    });
    await it("recentTopics feeds prior topics back to research", () => {
      eq(state.recentTopics(5), ["One", "Two"]);
    });
    await it("kv round-trips and survives re-read", () => {
      state.kvSet("pending_submissions", ["bsub_1"]);
      eq(state.kvGet("pending_submissions"), ["bsub_1"]);
      eq(state.kvGet("nope"), undefined);
    });
    await it("readJournal tolerates a corrupt line", () => {
      fs.appendFileSync(path.join(state.DATA_DIR, "journal.jsonl"), "{not json\n");
      eq(state.readJournal(10).length, 2, "corrupt line should be skipped");
    });
  }

  /* ------------------------- render internals -------------------------- */
  describe("render internals");
  {
    const { _test } = require(LIB("lib/render.js"));
    await it("assTime formats h:mm:ss.cc", () => {
      eq(_test.assTime(0), "0:00:00.00");
      eq(_test.assTime(65.5), "0:01:05.50");
      eq(_test.assTime(3725.25), "1:02:05.25");
    });
    await it("visual/audio filters are distinct (the music-bed bug)", () => {
      ok(_test.VISUAL_RE.test("a.mp4") && _test.VISUAL_RE.test("b.png"), "visual should match video/images");
      ok(!_test.VISUAL_RE.test("c.mp3"), "visual must not match audio");
      ok(_test.AUDIO_RE.test("c.mp3") && _test.AUDIO_RE.test("d.wav"), "audio should match audio");
      ok(!_test.AUDIO_RE.test("a.mp4"), "audio must not match video");
    });
    await it("pickAsset selects by kind and is deterministic per id", () => {
      buildAssets();
      const bg = _test.pickAsset(path.join(ASSETS, "backgrounds"), "seed1", _test.VISUAL_RE);
      const music = _test.pickAsset(path.join(ASSETS, "music"), "seed1", _test.AUDIO_RE);
      ok(bg && bg.endsWith("still.png"), `bg was ${bg}`);
      ok(music && music.endsWith("bed.wav"), `music was ${music}`);
      eq(_test.pickAsset(path.join(ASSETS, "backgrounds"), "seed1", _test.VISUAL_RE), bg, "same id -> same asset");
    });
    await it("pickAsset returns null for a missing dir", () => {
      eq(_test.pickAsset(path.join(TMP, "nope"), "x"), null);
    });
    await it("buildAss emits ordered, non-overlapping cues with a Hook first", () => {
      const cues = [
        { text: "Hook line", start: 0.45, end: 2.1 },
        { text: "Second", start: 2.4, end: 4.0 },
      ];
      const ass = _test.buildAss(cues);
      ok(ass.includes("PlayResX: 1080") && ass.includes("PlayResY: 1920"), "vertical canvas");
      const events = ass.split("\n").filter((l) => l.startsWith("Dialogue:"));
      eq(events.length, 2);
      ok(events[0].includes(",Hook,"), "first cue uses the Hook style");
      ok(events[1].includes(",Cap,"), "later cues use the Cap style");
      ok(events[0].includes("0:00:00.45"), "start time rendered");
    });
    await it("buildAss strips ASS control characters from text", () => {
      const ass = _test.buildAss([{ text: "a {evil} b", start: 0, end: 1 }]);
      ok(!ass.includes("{evil}"), "braces must be stripped");
    });
  }

  /* ---------------------- render (real ffmpeg + TTS) -------------------- */
  describe("render pipeline (real ffmpeg)");
  {
    const { render } = require(LIB("lib/render.js"));
    const quiet = () => {};

    await it("renders a 1080x1920 h264+aac short from a generated background", () => {
      const prevAssets = process.env.AUTOPILOT_ASSETS;
      process.env.AUTOPILOT_ASSETS = path.join(TMP, "empty-assets"); // force gradient path
      const { render: r } = reload("lib/render.js");
      const m = r(SCRIPT, "gradient", quiet);
      ok(fs.existsSync(m.videoPath), "video missing");
      ok(fs.existsSync(m.thumbPath), "thumbnail missing");
      eq(probe(m.videoPath, "stream=codec_name,width,height").split("\n")[0], "h264,1080,1920");
      ok(probe(m.videoPath, "stream=codec_name").includes("aac"), "no audio stream");
      if (prevAssets === undefined) delete process.env.AUTOPILOT_ASSETS;
      else process.env.AUTOPILOT_ASSETS = prevAssets;
    });

    await it("reported duration matches the real file (caption timing is sound)", () => {
      const { render: r } = reload("lib/render.js", { AUTOPILOT_ASSETS: path.join(TMP, "empty-assets") });
      const m = r(SCRIPT, "timing", quiet);
      const actual = parseFloat(probe(m.videoPath, "format=duration"));
      near(actual, m.durationSec, 0.75, "video length vs computed caption timeline");
      ok(m.durationSec > 5, "five spoken lines should exceed five seconds");
      r.__restoreEnv?.();
    });

    await it("uses an image background and mixes a music bed", () => {
      const mod = reload("lib/render.js", { AUTOPILOT_ASSETS: ASSETS });
      const logs = [];
      const m = mod.render(SCRIPT, "imgmusic", (s) => logs.push(s));
      ok(/bg=still\.png/.test(logs.join(" ")), `expected image bg, got: ${logs.join(" ")}`);
      ok(/music=bed\.wav/.test(logs.join(" ")), `expected music bed, got: ${logs.join(" ")}`);
      eq(probe(m.videoPath, "stream=codec_type").split("\n").sort(), ["audio", "video"], "exactly one a/v pair");
      mod.__restoreEnv();
    });

    await it("uses a looping video background shorter than the voiceover", () => {
      const mod = reload("lib/render.js", { AUTOPILOT_ASSETS: path.join(ASSETS, "vid") });
      const logs = [];
      const m = mod.render(SCRIPT, "vidbg", (s) => logs.push(s));
      ok(/bg=clip\.mp4/.test(logs.join(" ")), "expected the video background");
      const actual = parseFloat(probe(m.videoPath, "format=duration"));
      ok(actual > 5, "4s clip must loop to cover the full voiceover, got " + actual);
      eq(probe(m.videoPath, "stream=codec_name,width,height").split("\n")[0], "h264,1080,1920");
      mod.__restoreEnv();
    });

    await it("survives punctuation and quotes in caption text", () => {
      const mod = reload("lib/render.js", { AUTOPILOT_ASSETS: path.join(TMP, "empty-assets") });
      const m = mod.render(
        { title: "t", lines: ["It's here: \"big\" news, 100% real!", "Second line — with a dash."] },
        "punct",
        quiet
      );
      ok(fs.existsSync(m.videoPath), "render failed on punctuation");
      mod.__restoreEnv();
    });

    await it("cleans up its temp directory", () => {
      eq(fs.readdirSync(path.join(process.env.AUTOPILOT_DATA, "tmp")), [], "tmp/ should be empty");
    });
  }

  /* --------------------------- lib/script.js --------------------------- */
  describe("scriptwriting");
  {
    const CLAUDE_REPLY = {
      title: "x".repeat(200),
      lines: ["  Hook line.  ", "Body one.", "", "Body two.", "CTA line."],
      caption: "A caption.",
      hashtags: ["#Solar", "gadgets"],
      whop_post: { title: "w", content: "c" },
    };
    await it("trims, drops blanks, and clamps the title", async () => {
      mock("lib/claude.js", { askJSON: async () => JSON.parse(JSON.stringify(CLAUDE_REPLY)) });
      const { writeScript } = reload("lib/script.js");
      const s = await writeScript({ topic: "T", angle: "A" });
      eq(s.lines.length, 4, "blank line should be dropped");
      eq(s.lines[0], "Hook line.", "whitespace trimmed");
      ok(s.title.length <= 95, "title clamped");
      eq(s.hashtags, ["Solar", "gadgets"], "leading # stripped");
    });
    await it("merges campaign-required hashtags and mentions (paid compliance)", async () => {
      mock("lib/claude.js", { askJSON: async () => JSON.parse(JSON.stringify(CLAUDE_REPLY)) });
      const { writeScript } = reload("lib/script.js");
      const s = await writeScript({
        topic: "T", angle: "A",
        requirements: { hashtags: ["SolarCo", "gadgets"], mentions: ["@solarco"], must_include: [], avoid: [] },
      });
      eq(s.hashtags[0], "SolarCo", "required tag must lead");
      eq(s.hashtags.filter((h) => h === "gadgets").length, 1, "no duplicate tags");
      ok(s.caption.includes("@solarco"), "required mention appended to caption");
    });
    await it("does not duplicate a mention already present", async () => {
      mock("lib/claude.js", {
        askJSON: async () => ({ ...JSON.parse(JSON.stringify(CLAUDE_REPLY)), caption: "Hi @solarco already." }),
      });
      const { writeScript } = reload("lib/script.js");
      const s = await writeScript({ topic: "T", angle: "A", requirements: { mentions: ["@solarco"] } });
      eq((s.caption.match(/@solarco/g) || []).length, 1);
    });
    await it("rejects a too-short script instead of rendering junk", async () => {
      mock("lib/claude.js", { askJSON: async () => ({ title: "t", lines: ["only one"] }) });
      const { writeScript } = reload("lib/script.js");
      await throws(() => writeScript({ topic: "T", angle: "A" }), "too few lines");
    });
    unmock("lib/claude.js");
  }

  /* ------------------------ lib/whop-rewards.js ------------------------ */
  describe("whop content rewards");
  {
    const openBounty = (over = {}) => ({
      id: "bnt_ok", status: "open", title: "UGC solar shorts", description: "original faceless shorts",
      gross_reward_amount: 150, currency: "usd", budget_amount: 50000, gross_paid_out_amount: 100,
      spots_remaining: 20, accepted_deliverable_types: ["content_url"], business_goal_type: "ugc_content", ...over,
    });

    await it("filters out exhausted, closed, and wrong-deliverable campaigns", async () => {
      mock("lib/http.js", {
        requestJSON: async () => ({
          data: [
            openBounty(),
            openBounty({ id: "bnt_nospots", spots_remaining: 0 }),
            openBounty({ id: "bnt_spent", budget_amount: 1000, gross_paid_out_amount: 1000 }),
            openBounty({ id: "bnt_closed", status: "closed" }),
            openBounty({ id: "bnt_media", accepted_deliverable_types: ["media"] }),
          ],
          page_info: { has_next_page: false },
        }),
      });
      let sawIds = [];
      mock("lib/claude.js", {
        askJSON: async (_s, user) => {
          sawIds = [...user.matchAll(/"id": "(bnt_\w+)"/g)].map((m) => m[1]);
          return { bounty_id: "bnt_ok", reason: "fits", plan: { angle: "a", cta: "c" } };
        },
      });
      const rewards = reload("lib/whop-rewards.js", { WHOP_API_KEY: "k" });
      const pick = await rewards.pickBounty({ recent: [], log: () => {} });
      eq(sawIds, ["bnt_ok"], "only the feasible campaign should reach Claude");
      eq(pick.bounty.id, "bnt_ok");
      rewards.__restoreEnv();
    });

    await it("honors REWARDS_MIN_PER_1K as a payout floor", async () => {
      mock("lib/http.js", {
        requestJSON: async () => ({ data: [openBounty({ gross_reward_amount: 50 })], page_info: { has_next_page: false } }),
      });
      mock("lib/claude.js", { askJSON: async () => ({ bounty_id: null, reason: "none" }) });
      const rewards = reload("lib/whop-rewards.js", { WHOP_API_KEY: "k", REWARDS_MIN_PER_1K: "100" });
      eq(await rewards.pickBounty({ log: () => {} }), null, "below-floor campaign should be filtered out");
      rewards.__restoreEnv();
    });

    await it("paginates with the cursor until has_next_page is false", async () => {
      const urls = [];
      mock("lib/http.js", {
        requestJSON: async (url) => {
          urls.push(url);
          return urls.length === 1
            ? { data: [openBounty({ id: "b1" })], page_info: { has_next_page: true, end_cursor: "cur2" } }
            : { data: [openBounty({ id: "b2" })], page_info: { has_next_page: false } };
        },
      });
      const rewards = reload("lib/whop-rewards.js", { WHOP_API_KEY: "k" });
      const all = await rewards.listOpenBounties();
      eq(all.map((b) => b.id), ["b1", "b2"]);
      ok(urls[0].includes("status=open"), "must request only open campaigns");
      ok(urls[1].includes("after=cur2"), "second page must use the cursor");
      rewards.__restoreEnv();
    });

    await it("returns null (never invents a campaign) when nothing fits", async () => {
      mock("lib/http.js", { requestJSON: async () => ({ data: [openBounty()], page_info: {} }) });
      mock("lib/claude.js", { askJSON: async () => ({ bounty_id: null, reason: "all need source footage" }) });
      const rewards = reload("lib/whop-rewards.js", { WHOP_API_KEY: "k" });
      eq(await rewards.pickBounty({ log: () => {} }), null);
      rewards.__restoreEnv();
    });

    await it("rejects a hallucinated campaign id", async () => {
      mock("lib/http.js", { requestJSON: async () => ({ data: [openBounty()], page_info: {} }) });
      mock("lib/claude.js", { askJSON: async () => ({ bounty_id: "bnt_does_not_exist", plan: {} }) });
      const rewards = reload("lib/whop-rewards.js", { WHOP_API_KEY: "k" });
      await throws(() => rewards.pickBounty({ log: () => {} }), "unknown bounty");
      rewards.__restoreEnv();
    });

    await it("submits a content_url deliverable with an idempotency key", async () => {
      let call = null;
      mock("lib/http.js", { requestJSON: async (url, opts) => ((call = { url, opts }), { id: "bsub_1", status: "submitted" }) });
      const rewards = reload("lib/whop-rewards.js", { WHOP_API_KEY: "k" });
      const res = await rewards.submitClip({ bountyId: "bnt_ok", url: "https://youtube.com/shorts/x", caption: "c", idKey: "run1" });
      ok(call.url.endsWith("/bounty_submissions"), call.url);
      eq(call.opts.method, "POST");
      eq(call.opts.headers["Idempotency-Key"], "run1", "retries must not double-submit");
      eq(call.opts.body.bounty_id, "bnt_ok");
      eq(call.opts.body.deliverable, { type: "content_url", urls: ["https://youtube.com/shorts/x"], caption: "c" });
      eq(res.id, "bsub_1");
      rewards.__restoreEnv();
    });

    await it("reports approvals and denials with reasons", async () => {
      mock("lib/http.js", {
        requestJSON: async () => ({
          data: [
            { id: "bsub_1", status: "approved" },
            { id: "bsub_2", status: "denied", denial_reason: "missing required tag" },
            { id: "bsub_other", status: "approved" },
          ],
        }),
      });
      const rewards = reload("lib/whop-rewards.js", { WHOP_API_KEY: "k" });
      const out = await rewards.checkSubmissions(["bsub_1", "bsub_2"], () => {});
      eq(out, [
        { id: "bsub_1", status: "approved", denial_reason: null },
        { id: "bsub_2", status: "denied", denial_reason: "missing required tag" },
      ]);
      rewards.__restoreEnv();
    });
    unmock("lib/http.js");
    unmock("lib/claude.js");
  }

  /* ---------------------- platform posters + dispatch ------------------ */
  describe("posting");
  {
    await it("whop poster uses the tailored whop_post, not the generic caption", async () => {
      let call = null;
      mock("lib/http.js", { requestJSON: async (url, opts) => ((call = { url, opts }), { id: "fp_1" }) });
      const whop = reload("lib/platforms/whop.js", { WHOP_API_KEY: "k", WHOP_EXPERIENCE_ID: "exp_1" });
      await whop.post({
        whop_post: { title: "Tailored", content: "Tailored body." },
        title: "Generic", caption: "Generic caption",
        links: [{ platform: "youtube", url: "https://youtube.com/shorts/y" }],
      });
      eq(call.opts.body.title, "Tailored");
      ok(call.opts.body.content.startsWith("Tailored body."), call.opts.body.content);
      ok(call.opts.body.content.includes("[youtube](https://youtube.com/shorts/y)"), "links appended");
      eq(call.opts.body.experience_id, "exp_1");
      whop.__restoreEnv();
    });
    await it("whop poster falls back to caption when no whop_post exists", async () => {
      let call = null;
      mock("lib/http.js", { requestJSON: async (url, opts) => ((call = { url, opts }), { id: "fp_2" }) });
      const whop = reload("lib/platforms/whop.js", { WHOP_API_KEY: "k", WHOP_EXPERIENCE_ID: "exp_1" });
      await whop.post({ title: "Generic", caption: "Generic caption" });
      eq(call.opts.body.title, "Generic");
      eq(call.opts.body.content, "Generic caption");
      whop.__restoreEnv();
    });
    await it("whop poster sends company_id for the public forum", async () => {
      let call = null;
      mock("lib/http.js", { requestJSON: async (url, opts) => ((call = { url, opts }), { id: "fp_3" }) });
      const whop = reload("lib/platforms/whop.js", { WHOP_API_KEY: "k", WHOP_EXPERIENCE_ID: "public", WHOP_COMPANY_ID: "biz_1" });
      await whop.post({ title: "t", caption: "c" });
      eq(call.opts.body.company_id, "biz_1");
      whop.__restoreEnv();
    });
    await it("webhook poster returns no url (private endpoint must not leak)", async () => {
      mock("lib/http.js", { requestJSON: async () => ({ ok: true }) });
      const wh = reload("lib/platforms/webhook.js", { WEBHOOK_URL: "https://hooks.example.com/secret" });
      const r = await wh.post({ title: "t", caption: "c", hashtags: [], videoUrl: "https://v/1.mp4" });
      eq(r.url, null, "webhook URL must never be published or submitted");
      wh.__restoreEnv();
    });
    unmock("lib/http.js");

    await it("one failing platform never blocks the others", async () => {
      mock("lib/platforms/youtube.js", { name: "youtube", enabled: () => true, post: async () => ({ platform: "youtube", id: "y", url: "https://youtube.com/shorts/y" }) });
      mock("lib/platforms/instagram.js", { name: "instagram", enabled: () => true, post: async () => { throw new Error("IG token expired"); } });
      mock("lib/platforms/tiktok.js", { name: "tiktok", enabled: () => true, post: async () => ({ platform: "tiktok", id: "tk", url: null }) });
      mock("lib/platforms/webhook.js", { name: "webhook", enabled: () => false, post: async () => ({}) });
      mock("lib/platforms/whop.js", { name: "whop", enabled: () => true, post: async (item) => ({ platform: "whop", id: "w", url: null, _links: item.links }) });
      const { postEverywhere, enabledPlatforms } = reload("lib/post.js");
      const { results, errors } = await postEverywhere({ title: "t", caption: "c", hashtags: [] }, () => {});
      eq(results.map((r) => r.platform), ["youtube", "tiktok", "whop"]);
      eq(errors, [{ platform: "instagram", error: "IG token expired" }]);
      eq(enabledPlatforms().socials, ["youtube", "instagram", "tiktok"]);
      const whopResult = results.find((r) => r.platform === "whop");
      eq(whopResult._links, [{ platform: "youtube", id: "y", url: "https://youtube.com/shorts/y" }],
         "only real permalinks may be linked from the community post");
    });
    for (const p of ["youtube", "instagram", "tiktok", "webhook", "whop"]) unmock(`lib/platforms/${p}.js`);
  }

  /* --------------------------- orchestrator ---------------------------- */
  describe("orchestrator cycle");
  {
    const bounty = { id: "bnt_42", title: "SolarCo UGC", gross_reward_amount: 150, currency: "usd", spots_remaining: 10 };

    function stubDeps({ rewardsEnabled, postResults, onSubmit }) {
      mock("lib/claude.js", {
        ask: async () => "OK",
        askJSON: async () => ({
          topic: "Solar gadgets", angle: "three gadgets", why_now: "prices", cta: "Follow",
          ...JSON.parse(JSON.stringify(SCRIPT)),
        }),
      });
      mock("lib/whop-rewards.js", {
        enabled: () => rewardsEnabled,
        listOpenBounties: async () => [bounty],
        pickBounty: async () =>
          rewardsEnabled
            ? { bounty, plan: { angle: "a", platforms: ["youtube"], hashtags: ["solarco"], mentions: ["@solarco"], must_include: [], avoid: [], cta: "Follow" } }
            : null,
        submitClip: async (args) => (onSubmit ? onSubmit(args) : { id: "bsub_x", status: "submitted" }),
        checkSubmissions: async () => [],
      });
      mock("lib/post.js", {
        enabledPlatforms: () => ({ socials: ["youtube"], whop: true }),
        postEverywhere: async () => ({ results: postResults, errors: [] }),
      });
      mock("lib/research.js", {
        pickCampaign: async () => ({ topic: "Trending niche topic", angle: "a", cta: "Follow", trendCount: 3 }),
      });
      // script.js captured the *previous* section's claude stub at load time —
      // drop it so it re-binds to the one installed above (real scriptwriting
      // logic, fresh stub) rather than replaying that section's invalid reply.
      unmock("lib/script.js");
    }
    function loadAutopilot(env) {
      Object.assign(process.env, env);
      process.env.AUTOPILOT_ASSETS = path.join(TMP, "empty-assets");
      // re-read env-at-load-time modules under this test's environment
      for (const m of ["autopilot.js", "lib/render.js", "lib/state.js"]) delete require.cache[LIB(m)];
      return require(LIB("autopilot.js"));
    }

    await it("pickClipUrl prefers the campaign's platform and skips non-permalinks", () => {
      const ap = loadAutopilot({ AUTOPILOT_MODE: "niche" });
      const results = [
        { platform: "webhook", url: null },
        { platform: "tiktok", url: null },
        { platform: "youtube", url: "https://youtube.com/shorts/y" },
        { platform: "instagram", url: "https://www.instagram.com/reel/abc" },
      ];
      eq(ap.pickClipUrl(results, ["instagram"]), "https://www.instagram.com/reel/abc", "campaign preference wins");
      eq(ap.pickClipUrl(results, []), "https://youtube.com/shorts/y", "falls back to first permalink");
      eq(ap.pickClipUrl([{ platform: "tiktok", url: null }, { platform: "webhook", url: null }], []), null,
         "no permalink means nothing to submit");
    });

    await it("rewards cycle: campaign -> compliant short -> post -> submit -> journal", async () => {
      const submits = [];
      stubDeps({
        rewardsEnabled: true,
        postResults: [
          { platform: "youtube", id: "ytABC", url: "https://youtube.com/shorts/ytABC" },
          { platform: "whop", id: "wp", url: null },
        ],
        onSubmit: (a) => (submits.push(a), { id: "bsub_9", status: "submitted" }),
      });
      const ap = loadAutopilot({ AUTOPILOT_MODE: "rewards", WHOP_API_KEY: "k", ANTHROPIC_API_KEY: "k" });
      await ap.cycle({});
      const state = require(LIB("lib/state.js"));
      const entry = state.readJournal(1)[0];
      eq(entry.mode, "rewards");
      eq(entry.bounty.id, "bnt_42", "campaign recorded for payout tracking");
      eq(entry.submission.status, "submitted");
      eq(entry.submission.url, "https://youtube.com/shorts/ytABC", "the permalink is what was submitted");
      eq(submits[0].bountyId, "bnt_42");
      ok(entry.video && entry.duration > 0, "a real video was rendered");
      ok(fs.existsSync(path.join(state.DATA_DIR, "out", entry.video)), "rendered file exists on disk");
      ok((state.kvGet("pending_submissions") || []).includes("bsub_9"), "submission tracked for follow-up");
      eq(ap.status.lastRun.ok, true);
    });

    await it("no submission is attempted when no permalink came back", async () => {
      stubDeps({ rewardsEnabled: true, postResults: [{ platform: "webhook", id: null, url: null }] });
      const ap = loadAutopilot({ AUTOPILOT_MODE: "rewards", WHOP_API_KEY: "k", ANTHROPIC_API_KEY: "k" });
      await ap.cycle({});
      const entry = require(LIB("lib/state.js")).readJournal(1)[0];
      ok(entry.submission.error.includes("no public post URL"), JSON.stringify(entry.submission));
    });

    await it("niche mode runs research and submits nothing", async () => {
      stubDeps({ rewardsEnabled: false, postResults: [{ platform: "youtube", id: "y", url: "https://youtube.com/shorts/y" }] });
      const ap = loadAutopilot({ AUTOPILOT_MODE: "niche", ANTHROPIC_API_KEY: "k" });
      await ap.cycle({});
      const entry = require(LIB("lib/state.js")).readJournal(1)[0];
      eq(entry.mode, "niche");
      eq(entry.topic, "Trending niche topic", "came from trend research");
      eq(entry.submission, null);
      eq(entry.bounty, undefined);
    });

    await it("dry-run renders but never posts or submits", async () => {
      let posted = false;
      stubDeps({ rewardsEnabled: true, postResults: [] });
      mock("lib/post.js", {
        enabledPlatforms: () => ({ socials: [], whop: false }),
        postEverywhere: async () => ((posted = true), { results: [], errors: [] }),
      });
      const ap = loadAutopilot({ AUTOPILOT_MODE: "rewards", WHOP_API_KEY: "k", ANTHROPIC_API_KEY: "k" });
      await ap.cycle({ dryRun: true });
      const entry = require(LIB("lib/state.js")).readJournal(1)[0];
      eq(posted, false, "dry-run must not post");
      eq(entry.dryRun, true);
      eq(entry.submission, null, "dry-run must not submit to a campaign");
      ok(entry.video, "but it should still render");
    });

    await it("a failing cycle is journaled and never crashes the loop", async () => {
      stubDeps({ rewardsEnabled: true, postResults: [] });
      mock("lib/whop-rewards.js", {
        enabled: () => true,
        pickBounty: async () => { throw new Error("whop is down"); },
        checkSubmissions: async () => [],
      });
      const ap = loadAutopilot({ AUTOPILOT_MODE: "rewards", WHOP_API_KEY: "k", ANTHROPIC_API_KEY: "k" });
      const before = ap.status.failures;
      await ap.cycle({}); // must resolve, not reject
      eq(ap.status.failures, before + 1, "failure counted");
      eq(ap.status.running, false, "running flag released");
      ok(require(LIB("lib/state.js")).readJournal(1)[0].error.includes("whop is down"), "error journaled");
    });

    for (const m of ["lib/claude.js", "lib/whop-rewards.js", "lib/post.js", "lib/research.js"]) unmock(m);
  }

  /* ----------------------- status + media server ----------------------- */
  describe("status server");
  {
    const port = 34410 + (process.pid % 100);
    const dataDir = process.env.AUTOPILOT_DATA;
    let child;
    const get = (p) =>
      new Promise((resolve, reject) => {
        const req = http.get({ host: "127.0.0.1", port, path: p }, (res) => {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
        });
        req.on("error", reject);
        req.setTimeout(5000, () => req.destroy(new Error("timeout")));
      });

    await it("boots unconfigured without crashing (paused, server up)", async () => {
      const env = { ...process.env, AUTOPILOT_PORT: String(port), AUTOPILOT_DATA: dataDir };
      delete env.ANTHROPIC_API_KEY;
      delete env.WHOP_API_KEY;
      child = spawn(process.execPath, [path.join(__dirname, "..", "autopilot.js"), "loop"], { env, stdio: "ignore" });
      for (let i = 0; i < 40; i++) {
        try { await get("/status"); break; } catch { await new Promise((r) => setTimeout(r, 250)); }
      }
      const res = await get("/status");
      eq(res.status, 200);
      const body = JSON.parse(res.body.toString());
      eq(body.configured, false, "should report itself unconfigured");
      ok(Array.isArray(body.journal), "status exposes the journal");
      ok(body.interval_hours > 0, "cadence reported");
    });

    await it("serves rendered media for Instagram to pull", async () => {
      const file = fs.readdirSync(path.join(dataDir, "out")).find((f) => f.endsWith(".mp4"));
      ok(file, "no rendered video to serve");
      const res = await get(`/media/${file}`);
      eq(res.status, 200);
      eq(res.headers["content-type"], "video/mp4");
      eq(res.body.length, fs.statSync(path.join(dataDir, "out", file)).size, "full file streamed");
    });

    await it("404s unknown media and blocks path traversal", async () => {
      eq((await get("/media/nope.mp4")).status, 404);
      const trav = await get("/media/..%2f..%2fkv.json");
      ok(trav.status === 404 || !trav.body.toString().includes("pending_submissions"),
         "traversal must not expose the token/kv store");
    });

    if (child) child.kill();
  }

  /* -------------------------------- done ------------------------------- */
  console.log(`\n${failures.length ? "✖" : "✔"} ${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  [${f.section}] ${f.name}\n${f.error.stack.split("\n").slice(0, 3).join("\n")}`);
  }
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(failures.length ? 1 : 0);
}

main().catch((e) => {
  console.error("suite crashed:", e);
  process.exit(1);
});
