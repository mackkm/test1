/* YouTube Shorts uploader — YouTube Data API v3.
 *
 * Setup (one time):
 *   1. Google Cloud console: create a project, enable "YouTube Data API v3",
 *      create OAuth credentials of type "TV and Limited Input devices".
 *   2. Put YT_CLIENT_ID + YT_CLIENT_SECRET in the env, then on the VM run:
 *        node autopilot.js auth-youtube
 *      It prints a google.com/device code — approve it from your phone. The
 *      refresh token is stored in the data dir; no browser needed on the VM.
 *
 * A vertical video under 3 minutes is automatically a Short. */

"use strict";

const fs = require("fs");
const { request, requestJSON, form } = require("../http");
const { kvGet, kvSet } = require("../state");

const CLIENT_ID = process.env.YT_CLIENT_ID || "";
const CLIENT_SECRET = process.env.YT_CLIENT_SECRET || "";
const PRIVACY = process.env.YT_PRIVACY || "public";
const CATEGORY = process.env.YT_CATEGORY_ID || "22"; // People & Blogs

const enabled = () => Boolean(CLIENT_ID && CLIENT_SECRET);

/* Device flow: made for headless boxes. */
async function deviceAuth(log = console.log) {
  if (!enabled()) throw new Error("set YT_CLIENT_ID and YT_CLIENT_SECRET first");
  const dev = await requestJSON("https://oauth2.googleapis.com/device/code", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form({ client_id: CLIENT_ID, scope: "https://www.googleapis.com/auth/youtube.upload" }),
  });
  log(`\nOn any device, open  ${dev.verification_url}  and enter code:  ${dev.user_code}\n`);
  const deadline = Date.now() + dev.expires_in * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, (dev.interval || 5) * 1000));
    try {
      const tok = await requestJSON("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: form({
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          device_code: dev.device_code,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        }),
      });
      kvSet("yt_refresh_token", tok.refresh_token);
      log("YouTube authorized ✔ — refresh token saved to the data dir.");
      return;
    } catch (e) {
      if (e.json && ["authorization_pending", "slow_down"].includes(e.json.error)) continue;
      throw e;
    }
  }
  throw new Error("device code expired — run auth-youtube again");
}

async function accessToken() {
  const refresh = process.env.YT_REFRESH_TOKEN || kvGet("yt_refresh_token");
  if (!refresh) throw new Error("no YouTube refresh token — run: node autopilot.js auth-youtube");
  const tok = await requestJSON("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: refresh,
      grant_type: "refresh_token",
    }),
  });
  return tok.access_token;
}

/* multipart/related upload: JSON metadata part + video part, single request. */
async function post({ videoPath, title, caption, hashtags }) {
  const token = await accessToken();
  const meta = {
    snippet: {
      title: `${title} #Shorts`.slice(0, 100),
      description: `${caption}\n\n${hashtags.map((h) => `#${h}`).join(" ")}`,
      categoryId: CATEGORY,
    },
    status: { privacyStatus: PRIVACY, selfDeclaredMadeForKids: false },
  };
  const boundary = "autopilot" + Date.now().toString(36);
  const head = Buffer.from(
    `--${boundary}\r\ncontent-type: application/json; charset=utf-8\r\n\r\n` +
      JSON.stringify(meta) +
      `\r\n--${boundary}\r\ncontent-type: video/mp4\r\n\r\n`
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  const video = fs.readFileSync(videoPath);
  const body = Buffer.concat([head, video, tail]);
  const res = await request(
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=multipart&part=snippet,status",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": `multipart/related; boundary=${boundary}`,
        "content-length": body.length,
      },
      body,
      timeoutMs: 600000,
    }
  );
  const json = JSON.parse(res.body.toString("utf8"));
  if (res.status >= 400) throw new Error(`youtube upload HTTP ${res.status}: ${JSON.stringify(json).slice(0, 400)}`);
  return { platform: "youtube", id: json.id, url: `https://youtube.com/shorts/${json.id}` };
}

module.exports = { name: "youtube", enabled, post, deviceAuth, accessToken };
