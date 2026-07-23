#!/usr/bin/env node
/* Campaign Shorts Autopilot — research trends, script + render a vertical
 * short, post it to your socials, then announce it on Whop. Forever.
 *
 * Zero npm dependencies. System requirements: node >= 16, ffmpeg, and a TTS
 * engine (espeak-ng, or Piper for natural voices).
 *
 * Commands:
 *   node autopilot.js               24/7 loop (POSTS_PER_DAY per day) + status server
 *   node autopilot.js once          one full cycle, then exit
 *   node autopilot.js dry-run       research + script + render, but skip posting
 *   node autopilot.js test-render   render a built-in sample script (no API keys needed)
 *   node autopilot.js auth-youtube  one-time YouTube device authorization
 *   node autopilot.js status        print current state and exit
 *
 * Configuration is entirely env-driven — see .env.example (installed to
 * /etc/autopilot.env by the Hetzner deploy). */

"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const state = require("./lib/state");
const { pickCampaign } = require("./lib/research");
const { writeScript } = require("./lib/script");
const { render } = require("./lib/render");
const { postEverywhere, enabledPlatforms } = require("./lib/post");

const POSTS_PER_DAY = Math.max(0.1, Number(process.env.POSTS_PER_DAY || 3));
const INTERVAL_MS = Math.round((24 * 3600 * 1000) / POSTS_PER_DAY);
const PORT = Number(process.env.AUTOPILOT_PORT || 3444);
const HOST = process.env.AUTOPILOT_HOST || "0.0.0.0";
const PUBLIC_BASE = (process.env.AUTOPILOT_PUBLIC_BASE || "").replace(/\/$/, "");
const KEEP_VIDEOS = Number(process.env.KEEP_VIDEOS || 50);

const log = (...a) => console.error(new Date().toISOString(), ...a);

const status = {
  startedAt: new Date().toISOString(),
  configured: Boolean(process.env.ANTHROPIC_API_KEY),
  platforms: enabledPlatforms(),
  running: false,
  lastRun: null,
  nextRunAt: null,
  runs: 0,
  failures: 0,
};

/* ---------- one full cycle: research -> script -> render -> post ---------- */

async function cycle({ dryRun = false } = {}) {
  const id = crypto.randomBytes(5).toString("hex");
  status.running = true;
  const t0 = Date.now();
  try {
    log(`[cycle ${id}] researching campaigns…`);
    const campaign = await pickCampaign({ recentTopics: state.recentTopics(), log });
    log(`[cycle ${id}] campaign: "${campaign.topic}" — ${campaign.angle} (${campaign.trendCount} trend signals)`);

    log(`[cycle ${id}] writing script…`);
    const script = await writeScript(campaign);

    log(`[cycle ${id}] rendering short…`);
    const media = render(script, id, log);

    const item = {
      ...script,
      topic: campaign.topic,
      videoPath: media.videoPath,
      thumbPath: media.thumbPath,
      durationSec: media.durationSec,
      videoUrl: PUBLIC_BASE ? `${PUBLIC_BASE}/media/${path.basename(media.videoPath)}` : null,
      thumbUrl: PUBLIC_BASE ? `${PUBLIC_BASE}/media/${path.basename(media.thumbPath)}` : null,
    };

    let posted = { results: [], errors: [] };
    if (dryRun) {
      log(`[cycle ${id}] dry-run: skipping posting. Video at ${media.videoPath}`);
    } else {
      posted = await postEverywhere(item, log);
    }

    state.journal({
      id,
      topic: campaign.topic,
      title: script.title,
      video: path.basename(media.videoPath),
      duration: Number(media.durationSec.toFixed(1)),
      posts: posted.results,
      postErrors: posted.errors,
      dryRun,
    });
    status.lastRun = { id, ok: true, topic: campaign.topic, at: new Date().toISOString(), posted: posted.results.length, errors: posted.errors.length };
    status.runs++;
    prune();
    log(`[cycle ${id}] done in ${((Date.now() - t0) / 1000).toFixed(0)}s — posted to ${posted.results.length} platform(s), ${posted.errors.length} error(s)`);
  } catch (e) {
    status.failures++;
    status.lastRun = { id, ok: false, error: e.message, at: new Date().toISOString() };
    state.journal({ id, error: e.message });
    log(`[cycle ${id}] FAILED: ${e.message}`);
  } finally {
    status.running = false;
  }
}

/* keep the newest N rendered videos so a small VM disk never fills up */
function prune() {
  const dir = path.join(state.DATA_DIR, "out");
  const files = fs
    .readdirSync(dir)
    .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  for (const { f } of files.slice(KEEP_VIDEOS * 2)) fs.rmSync(path.join(dir, f), { force: true }); // *2: video + thumb
}

/* ---------------- status + media server (needed for IG pulls) ------------- */

function serve() {
  const outDir = path.join(state.DATA_DIR, "out");
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    if (u.pathname === "/status") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ ...status, interval_hours: INTERVAL_MS / 3600000, journal: state.readJournal(10) }, null, 2));
    }
    if (u.pathname.startsWith("/media/")) {
      const file = path.join(outDir, path.basename(u.pathname)); // basename() blocks traversal
      if (!fs.existsSync(file)) {
        res.writeHead(404);
        return res.end("not found");
      }
      const type = file.endsWith(".jpg") ? "image/jpeg" : "video/mp4";
      res.writeHead(200, { "content-type": type, "content-length": fs.statSync(file).size });
      return fs.createReadStream(file).pipe(res);
    }
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("campaign-shorts-autopilot — see /status\n");
  });
  server.listen(PORT, HOST, () => log(`status + media server on http://${HOST}:${PORT} (/status, /media/*)`));
}

/* --------------------------------- modes ---------------------------------- */

const SAMPLE_SCRIPT = {
  title: "Test render — your autopilot works",
  lines: [
    "Your content autopilot is officially alive.",
    "Every few hours it scans what is trending in your niche.",
    "Claude turns the best angle into a tight script.",
    "F F M P E G renders it into a vertical short.",
    "Captions are timed to the voice automatically.",
    "Then it posts to your socials and your Whop.",
    "Add your keys, and it runs twenty four seven.",
  ],
  caption: "Rendered locally by the autopilot test command.",
  hashtags: ["test"],
  whop_post: null,
};

async function main() {
  const cmd = process.argv[2] || "loop";
  state.ensure();

  if (cmd === "test-render") {
    const media = render(SAMPLE_SCRIPT, "testrender", log);
    log(`test render OK -> ${media.videoPath} (${media.durationSec.toFixed(1)}s)`);
    return;
  }
  if (cmd === "auth-youtube") {
    return require("./lib/platforms/youtube").deviceAuth(console.log);
  }
  if (cmd === "status") {
    console.log(JSON.stringify({ ...status, journal: state.readJournal(10) }, null, 2));
    return;
  }
  if (cmd === "once" || cmd === "dry-run") {
    requireConfig();
    await cycle({ dryRun: cmd === "dry-run" });
    return;
  }
  if (cmd !== "loop") {
    console.error(`unknown command: ${cmd}`);
    process.exit(2);
  }

  // ---- 24/7 loop ----
  serve();
  if (!status.configured) {
    log("NOT CONFIGURED: set ANTHROPIC_API_KEY (and platform keys) in /etc/autopilot.env, then restart.");
    log("The status server stays up; the posting loop is paused until configured.");
    setInterval(() => {
      status.configured = Boolean(process.env.ANTHROPIC_API_KEY);
    }, 60000);
    return; // systemd restart after editing env brings the loop up
  }
  const p = enabledPlatforms();
  log(`autopilot up: ${POSTS_PER_DAY}/day (every ${(INTERVAL_MS / 3600000).toFixed(1)}h), socials=[${p.socials.join(", ") || "none"}], whop=${p.whop}`);
  if (!p.socials.length && !p.whop) log("WARNING: no posting platform configured — cycles will render but publish nowhere.");

  const tick = async () => {
    await cycle();
    const jitter = INTERVAL_MS * 0.1 * (Math.random() * 2 - 1);
    const delay = Math.max(60000, INTERVAL_MS + jitter);
    status.nextRunAt = new Date(Date.now() + delay).toISOString();
    log(`next cycle at ${status.nextRunAt}`);
    setTimeout(tick, delay);
  };
  tick();
}

function requireConfig() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY is required for this command (research + scriptwriting).");
    process.exit(2);
  }
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
