/* TikTok via the Content Posting API (Direct Post, FILE_UPLOAD).
 *
 * Env: TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET, TIKTOK_REFRESH_TOKEN.
 * Get the refresh token once via TikTok's OAuth (video.publish scope) — see
 * autopilot/README.md. Access tokens are refreshed automatically here.
 *
 * Heads-up: until your TikTok app passes their content-posting audit, TikTok
 * forces posts to SELF_ONLY visibility. TIKTOK_PRIVACY defaults to SELF_ONLY
 * so unaudited apps still succeed; switch to PUBLIC_TO_EVERYONE after audit. */

"use strict";

const fs = require("fs");
const { request, requestJSON, form } = require("../http");
const { kvGet, kvSet } = require("../state");

const CLIENT_KEY = process.env.TIKTOK_CLIENT_KEY || "";
const CLIENT_SECRET = process.env.TIKTOK_CLIENT_SECRET || "";
const PRIVACY = process.env.TIKTOK_PRIVACY || "SELF_ONLY";
const API = "https://open.tiktokapis.com/v2";

const enabled = () =>
  Boolean(CLIENT_KEY && CLIENT_SECRET && (process.env.TIKTOK_REFRESH_TOKEN || kvGet("tiktok_refresh_token")));

async function accessToken() {
  const refresh = kvGet("tiktok_refresh_token") || process.env.TIKTOK_REFRESH_TOKEN;
  const tok = await requestJSON(`${API}/oauth/token/`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form({
      client_key: CLIENT_KEY,
      client_secret: CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: refresh,
    }),
  });
  if (!tok.access_token) throw new Error(`tiktok token refresh failed: ${JSON.stringify(tok).slice(0, 300)}`);
  if (tok.refresh_token) kvSet("tiktok_refresh_token", tok.refresh_token); // rotates
  return tok.access_token;
}

async function post({ videoPath, title, hashtags }) {
  const token = await accessToken();
  const video = fs.readFileSync(videoPath);
  const init = await requestJSON(`${API}/post/publish/video/init/`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: {
      post_info: {
        title: `${title} ${hashtags.slice(0, 4).map((h) => `#${h}`).join(" ")}`.slice(0, 150),
        privacy_level: PRIVACY,
        disable_duet: false,
        disable_comment: false,
        disable_stitch: false,
      },
      source_info: {
        source: "FILE_UPLOAD",
        video_size: video.length,
        chunk_size: video.length, // shorts are small; single-chunk upload
        total_chunk_count: 1,
      },
    },
  });
  const { publish_id, upload_url } = init.data || {};
  if (!upload_url) throw new Error(`tiktok init failed: ${JSON.stringify(init).slice(0, 300)}`);

  const up = await request(upload_url, {
    method: "PUT",
    headers: {
      "content-type": "video/mp4",
      "content-length": video.length,
      "content-range": `bytes 0-${video.length - 1}/${video.length}`,
    },
    body: video,
    timeoutMs: 600000,
  });
  if (up.status >= 400) throw new Error(`tiktok upload HTTP ${up.status}`);

  // poll processing status until TikTok accepts or rejects the post
  const deadline = Date.now() + 5 * 60 * 1000;
  for (;;) {
    await new Promise((r) => setTimeout(r, 8000));
    const st = await requestJSON(`${API}/post/publish/status/fetch/`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: { publish_id },
    });
    const status = st.data && st.data.status;
    if (status === "PUBLISH_COMPLETE") break;
    if (status === "FAILED") throw new Error(`tiktok publish failed: ${st.data.fail_reason || "unknown"}`);
    if (Date.now() > deadline) throw new Error("tiktok publish timed out");
  }
  return { platform: "tiktok", id: publish_id, url: "https://www.tiktok.com/@me" };
}

module.exports = { name: "tiktok", enabled, post };
