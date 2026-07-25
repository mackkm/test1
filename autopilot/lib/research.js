/* Campaign research: pull what's trending right now from keyless public
 * sources, then have Claude pick ONE campaign angle for the operator's niche.
 *
 * Sources (each optional, all free / no API key):
 *   - Google Trends daily RSS        (TRENDS_GEO, default US)
 *   - Reddit top-of-day for niche subreddits (RESEARCH_SUBREDDITS, csv)
 *   - Hacker News front page         (RESEARCH_HN=1)
 *
 * If every source is unreachable the autopilot still works: Claude generates
 * an evergreen campaign for the niche instead of a trend-reactive one. */

"use strict";

const { requestFollow, requestJSON } = require("./http");
const { askJSON } = require("./claude");

const GEO = process.env.TRENDS_GEO || "US";
const SUBREDDITS = (process.env.RESEARCH_SUBREDDITS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const USE_HN = process.env.RESEARCH_HN === "1";

async function googleTrends() {
  const res = await requestFollow(`https://trends.google.com/trending/rss?geo=${GEO}`, {
    timeoutMs: 20000,
  });
  if (res.status !== 200) throw new Error(`trends rss HTTP ${res.status}`);
  const xml = res.body.toString("utf8");
  const items = [];
  const re = /<item>[\s\S]*?<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>[\s\S]*?(?:<ht:approx_traffic>(.*?)<\/ht:approx_traffic>)?[\s\S]*?<\/item>/g;
  let m;
  while ((m = re.exec(xml)) && items.length < 20) {
    items.push({ source: "google-trends", title: decodeEntities(m[1]), traffic: m[2] || "" });
  }
  return items;
}

async function reddit(sub) {
  const json = await requestJSON(
    `https://www.reddit.com/r/${encodeURIComponent(sub)}/top.json?t=day&limit=15`,
    { headers: { "user-agent": "campaign-autopilot/1.0 (research)" }, timeoutMs: 20000 }
  );
  return (json.data?.children || []).map((c) => ({
    source: `r/${sub}`,
    title: c.data.title,
    traffic: `${c.data.ups} upvotes`,
  }));
}

async function hackerNews() {
  const json = await requestJSON(
    "https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=20",
    { timeoutMs: 20000 }
  );
  return (json.hits || []).map((h) => ({
    source: "hacker-news",
    title: h.title,
    traffic: `${h.points} points`,
  }));
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n));
}

/* Gather all configured sources; a failing source logs and is skipped. */
async function gatherTrends(log = console.error) {
  const jobs = [
    googleTrends().catch((e) => (log(`[research] google trends failed: ${e.message}`), [])),
    ...SUBREDDITS.map((s) =>
      reddit(s).catch((e) => (log(`[research] r/${s} failed: ${e.message}`), []))
    ),
  ];
  if (USE_HN) jobs.push(hackerNews().catch((e) => (log(`[research] HN failed: ${e.message}`), [])));
  return (await Promise.all(jobs)).flat();
}

/* Turn raw trends + operator profile into one concrete campaign brief. */
async function pickCampaign({ recentTopics = [], log = console.error } = {}) {
  const niche = process.env.NICHE || "general audience";
  const audience = process.env.AUDIENCE || "people interested in the niche";
  const offer = process.env.OFFER || "";
  const trends = await gatherTrends(log);

  const trendBlock = trends.length
    ? trends
        .slice(0, 60)
        .map((t) => `- [${t.source}] ${t.title}${t.traffic ? ` (${t.traffic})` : ""}`)
        .join("\n")
    : "(no live trend data available — propose an evergreen campaign instead)";

  const system =
    "You are a short-form video campaign strategist. You pick ONE campaign concept " +
    "for a 30-45 second vertical video (YouTube Short / Reel / TikTok). Prefer trend-reactive " +
    "ideas when a trend genuinely fits the niche; otherwise pick a strong evergreen angle. " +
    "Never repeat a recently covered topic. Keep it brand-safe: no medical, financial or " +
    "legal advice framed as guarantees, nothing misleading, no impersonation.";

  const user = `Niche: ${niche}
Audience: ${audience}
${offer ? `Offer to soft-promote (the CTA should point here): ${offer}\n` : ""}
Recently covered topics (avoid these): ${recentTopics.join("; ") || "(none yet)"}

Live trends right now:
${trendBlock}

Return JSON: {"topic": short topic name, "angle": one-sentence video concept, "why_now": one sentence, "keywords": [3-6 strings], "cta": one short call-to-action line}`;

  const campaign = await askJSON(system, user, { maxTokens: 800 });
  if (!campaign.topic || !campaign.angle) throw new Error("research: campaign missing topic/angle");
  campaign.trendCount = trends.length;
  return campaign;
}

module.exports = { gatherTrends, pickCampaign };
