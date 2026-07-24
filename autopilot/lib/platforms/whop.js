/* Whop community poster — announces each new short to your Whop as a forum
 * post (with links to wherever it was published), so members always see the
 * content after it goes out to socials.
 *
 * Env: WHOP_API_KEY       company/app API key (whop.com dashboard → developer)
 *      WHOP_EXPERIENCE_ID forum experience id ("exp_…"), or "public"
 *      WHOP_COMPANY_ID    required only when WHOP_EXPERIENCE_ID=public
 *
 * API: POST https://api.whop.com/api/v1/forum_posts  (Bearer auth) */

"use strict";

const { requestJSON } = require("../http");

const API_KEY = process.env.WHOP_API_KEY || "";
const EXPERIENCE = process.env.WHOP_EXPERIENCE_ID || "";
const COMPANY = process.env.WHOP_COMPANY_ID || "";
const BASE = process.env.WHOP_BASE_URL || "https://api.whop.com/api/v1";

const enabled = () => Boolean(API_KEY && EXPERIENCE);

async function post({ whopPost, title, caption, links = [] }) {
  const linkLines = links.length
    ? "\n\n" + links.map((l) => `▶ [${l.platform}](${l.url})`).join("\n")
    : "";
  const body = {
    experience_id: EXPERIENCE,
    title: (whopPost && whopPost.title) || title,
    content: ((whopPost && whopPost.content) || caption) + linkLines,
  };
  if (EXPERIENCE === "public" && COMPANY) body.company_id = COMPANY;
  const res = await requestJSON(`${BASE}/forum_posts`, {
    method: "POST",
    headers: { authorization: `Bearer ${API_KEY}` },
    body,
  });
  return { platform: "whop", id: res.id || null, url: res.url || null };
}

module.exports = { name: "whop", enabled, post };
