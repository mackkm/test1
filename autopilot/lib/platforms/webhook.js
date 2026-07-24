/* Generic webhook poster — the universal escape hatch.
 *
 * Set WEBHOOK_URL to a Zapier "Catch Hook", Make.com webhook, Buffer, n8n, or
 * anything you run yourself, and every finished short is POSTed there as JSON:
 *   { title, caption, hashtags, video_url, thumb_url, topic, duration_sec }
 * Your automation then fans it out to platforms the native integrations here
 * don't cover (or replaces them entirely — this is the fastest way to go live
 * without creating any platform developer apps). */

"use strict";

const { requestJSON } = require("../http");

const URL_ = process.env.WEBHOOK_URL || "";
const enabled = () => Boolean(URL_);

async function post({ title, caption, hashtags, videoUrl, thumbUrl, topic, durationSec }) {
  const res = await requestJSON(URL_, {
    method: "POST",
    body: {
      title,
      caption,
      hashtags,
      video_url: videoUrl || null,
      thumb_url: thumbUrl || null,
      topic,
      duration_sec: durationSec,
    },
  });
  return { platform: "webhook", id: null, url: URL_, response: typeof res === "string" ? res.slice(0, 200) : res };
}

module.exports = { name: "webhook", enabled, post };
