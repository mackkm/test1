/* Whop Content Rewards engine — the money loop.
 *
 * Content Rewards ("bounties" in Whop's API) are campaigns where brands pay a
 * fixed reward per 1,000 views for short clips posted to socials. This module:
 *   1. lists open bounties        GET  /bounties?status=open
 *   2. has Claude pick ONE we can genuinely fulfill with an original
 *      AI-generated vertical short, and extract its requirements
 *   3. submits the posted clip    POST /bounty_submissions
 *   4. checks earlier submissions for approved/denied so the journal (and
 *      future campaign picks) learn from denial reasons
 *
 * Auth: WHOP_API_KEY (your personal/company API key — submissions are made by
 * the authenticated account, and payouts land on its Whop balance).
 *
 * Honest scope note: "clipping" bounties that require cutting the brand's own
 * source footage are skipped automatically — we only take campaigns satisfiable
 * with original content (ugc/faceless/engagement styles), unless you've put
 * usable source assets into assets/backgrounds. Approval is always at the
 * campaign owner's discretion; denials are journaled, never retried blindly. */

"use strict";

const { requestJSON } = require("./http");
const { askJSON } = require("./claude");

const API_KEY = process.env.WHOP_API_KEY || "";
const BASE = process.env.WHOP_BASE_URL || "https://api.whop.com/api/v1";
const MIN_REWARD = Number(process.env.REWARDS_MIN_PER_1K || 0); // usd cents? (bounty amounts are integer minor units)

const enabled = () => Boolean(API_KEY);

const auth = { authorization: `Bearer ${API_KEY}` };

async function listOpenBounties() {
  const out = [];
  let after;
  for (let page = 0; page < 3; page++) {
    const qs = new URLSearchParams({ status: "open", first: "50", order: "created_at", direction: "desc" });
    if (after) qs.set("after", after);
    const res = await requestJSON(`${BASE}/bounties?${qs}`, { headers: auth });
    const items = res.data || res.bounties || [];
    out.push(...items);
    after = res.page_info?.end_cursor;
    if (!after || !res.page_info?.has_next_page) break;
  }
  return out;
}

/* Hard filters before Claude sees anything: open, has spots + budget left,
 * accepts a URL deliverable, and isn't priced below the operator's floor. */
function feasible(b) {
  if (b.status !== "open") return false;
  if (typeof b.spots_remaining === "number" && b.spots_remaining <= 0) return false;
  if ((b.accepted_deliverable_types || []).length && !b.accepted_deliverable_types.includes("content_url")) return false;
  if (b.budget_amount && b.gross_paid_out_amount >= b.budget_amount) return false;
  if (MIN_REWARD && (b.gross_reward_amount || 0) < MIN_REWARD) return false;
  return true;
}

/* -> { bounty, plan } or null when no campaign fits original-content work. */
async function pickBounty({ recent = [], log = console.error } = {}) {
  const all = await listOpenBounties();
  const open = all.filter(feasible);
  log(`[rewards] ${all.length} bounties fetched, ${open.length} feasible after filters`);
  if (!open.length) return null;

  const compact = open.slice(0, 40).map((b) => ({
    id: b.id,
    title: b.title,
    reward: b.gross_reward_amount,
    currency: b.currency,
    budget: b.budget_amount,
    paid_out: b.gross_paid_out_amount,
    spots: b.spots_remaining,
    goal: b.business_goal_type,
    desc: String(b.description || "").slice(0, 500),
  }));

  const system =
    "You are selecting ONE Whop Content Rewards campaign for an automated pipeline that can " +
    "only produce ORIGINAL 30-45s vertical shorts: TTS voiceover, big captions, generated or " +
    "operator-supplied background footage. It can NOT cut clips from a brand's streams/podcasts, " +
    "can NOT show a human face, can NOT play copyrighted music. Reject campaigns that require " +
    "those. Prefer higher reward-per-1k and remaining budget, but feasibility beats payout. " +
    "Read each description carefully for platform, hashtag, mention, format and disclosure rules.";

  const user = `Recently attempted campaign ids (deprioritize, don't exclude): ${recent.join(", ") || "(none)"}

Open campaigns:
${JSON.stringify(compact, null, 1)}

Return JSON:
{"bounty_id": "the chosen id, or null if NONE is genuinely satisfiable with original content",
 "reason": "one sentence",
 "plan": {"angle": "one-sentence concept for a compliant original short",
          "platforms": ["which platforms the campaign wants, lowercase"],
          "hashtags": ["required + smart tags, no # sign"],
          "mentions": ["required @handles, empty if none"],
          "must_include": ["hard requirements from the brief, e.g. disclosures, product name pronunciations"],
          "avoid": ["explicit prohibitions from the brief"],
          "cta": "closing line for the short"}}`;

  const choice = await askJSON(system, user, { maxTokens: 900 });
  if (!choice.bounty_id) {
    log(`[rewards] no satisfiable campaign: ${choice.reason || "no reason given"}`);
    return null;
  }
  const bounty = open.find((b) => b.id === choice.bounty_id);
  if (!bounty) throw new Error(`rewards: Claude chose unknown bounty ${choice.bounty_id}`);
  log(`[rewards] chose "${bounty.title}" (${bounty.gross_reward_amount} ${bounty.currency}/1k, ${bounty.spots_remaining} spots) — ${choice.reason}`);
  return { bounty, plan: choice.plan || {} };
}

async function submitClip({ bountyId, url, caption, idKey }) {
  return requestJSON(`${BASE}/bounty_submissions`, {
    method: "POST",
    headers: { ...auth, ...(idKey ? { "Idempotency-Key": idKey } : {}) },
    body: {
      bounty_id: bountyId,
      deliverable: { type: "content_url", urls: [url], caption: caption || null },
    },
  });
}

/* Look up the fate of earlier submissions so approvals/denials get journaled. */
async function checkSubmissions(ids, log = console.error) {
  if (!ids.length) return [];
  const res = await requestJSON(`${BASE}/bounty_submissions?first=50`, { headers: auth });
  const mine = (res.data || []).filter((s) => ids.includes(s.id));
  for (const s of mine) {
    if (s.status === "approved") log(`[rewards] submission ${s.id} APPROVED ✔`);
    if (s.status === "denied") log(`[rewards] submission ${s.id} denied: ${s.denial_reason || "no reason"}`);
  }
  return mine.map((s) => ({ id: s.id, status: s.status, denial_reason: s.denial_reason || null }));
}

module.exports = { enabled, listOpenBounties, pickBounty, submitClip, checkSubmissions };
