/* Shorts scriptwriting: campaign brief -> tight line-by-line script the
 * renderer can turn into TTS + captions, plus platform copy (title, caption,
 * hashtags) and the Whop community post. */

"use strict";

const { askJSON } = require("./claude");

async function writeScript(campaign) {
  const niche = process.env.NICHE || "general audience";
  const offer = process.env.OFFER || "";
  const tone = process.env.TONE || "energetic, direct, no fluff";

  const system =
    "You write scripts for 30-45 second vertical shorts that are read aloud by TTS with " +
    "big on-screen captions. Rules: the first line is a scroll-stopping hook under 12 words; " +
    "each line is ONE spoken sentence under 15 words; 7-10 lines total (~70-100 words); " +
    "the last line is the call-to-action. Plain spoken language only — no emojis, no " +
    "stage directions, no hashtags inside lines. Keep claims honest and brand-safe.";

  const user = `Niche: ${niche}
Campaign topic: ${campaign.topic}
Angle: ${campaign.angle}
Why now: ${campaign.why_now || ""}
CTA to end on: ${campaign.cta || offer || "follow for more"}

Return JSON:
{
 "title": "video title, <=90 chars, include one strong keyword",
 "lines": ["line 1 (the hook)", "..."],
 "caption": "2-3 sentence social caption ending with the CTA",
 "hashtags": ["5-8 tags without the # sign"],
 "whop_post": {"title": "post title for the Whop community", "content": "2-4 sentence markdown post telling members about the new short and its takeaway"}
}`;

  const s = await askJSON(system, user, { maxTokens: 1200 });
  if (!Array.isArray(s.lines) || s.lines.length < 3) throw new Error("script: too few lines");
  s.lines = s.lines.map((l) => String(l).trim()).filter(Boolean).slice(0, 12);
  s.hashtags = (s.hashtags || []).map((h) => String(h).replace(/^#/, "").trim()).filter(Boolean);
  s.title = String(s.title || campaign.topic).slice(0, 95);
  return s;
}

module.exports = { writeScript };
