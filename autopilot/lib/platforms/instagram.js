/* Instagram Reels via the Instagram Graph API (professional account required,
 * linked to a Facebook Page; app needs instagram_content_publish).
 *
 * Env: IG_USER_ID (numeric), IG_ACCESS_TOKEN (long-lived page/user token).
 *
 * The Graph API pulls the video from a public URL, so the autopilot's built-in
 * media server must be reachable: set AUTOPILOT_PUBLIC_BASE to
 * http://<vm-public-ip>:<port> (the orchestrator passes videoUrl in). */

"use strict";

const { requestJSON, form } = require("../http");

const IG_USER = process.env.IG_USER_ID || "";
const TOKEN = process.env.IG_ACCESS_TOKEN || "";
const GRAPH = process.env.IG_GRAPH_BASE || "https://graph.facebook.com/v21.0";

const enabled = () => Boolean(IG_USER && TOKEN);

async function post({ videoUrl, caption, hashtags }) {
  if (!videoUrl) throw new Error("instagram needs AUTOPILOT_PUBLIC_BASE (public video URL)");
  const fullCaption = `${caption}\n\n${hashtags.map((h) => `#${h}`).join(" ")}`.slice(0, 2200);
  const container = await requestJSON(`${GRAPH}/${IG_USER}/media`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form({
      media_type: "REELS",
      video_url: videoUrl,
      caption: fullCaption,
      share_to_feed: "true",
      access_token: TOKEN,
    }),
  });

  // IG downloads + transcodes asynchronously; poll until the container is ready.
  const deadline = Date.now() + 5 * 60 * 1000;
  for (;;) {
    await new Promise((r) => setTimeout(r, 8000));
    const st = await requestJSON(
      `${GRAPH}/${container.id}?fields=status_code&access_token=${encodeURIComponent(TOKEN)}`
    );
    if (st.status_code === "FINISHED") break;
    if (st.status_code === "ERROR") throw new Error("instagram container processing failed");
    if (Date.now() > deadline) throw new Error("instagram container processing timed out");
  }

  const pub = await requestJSON(`${GRAPH}/${IG_USER}/media_publish`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form({ creation_id: container.id, access_token: TOKEN }),
  });
  return { platform: "instagram", id: pub.id, url: `https://www.instagram.com/reel/${pub.id}` };
}

module.exports = { name: "instagram", enabled, post };
