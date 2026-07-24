/* Posting dispatcher: fan a finished short out to every enabled social
 * platform, then announce on Whop with links to what was published.
 * One platform failing never blocks the others — errors are collected and
 * journaled so /status shows exactly what went out and what didn't. */

"use strict";

const youtube = require("./platforms/youtube");
const instagram = require("./platforms/instagram");
const tiktok = require("./platforms/tiktok");
const webhook = require("./platforms/webhook");
const whop = require("./platforms/whop");

const SOCIALS = [youtube, instagram, tiktok, webhook];

function enabledPlatforms() {
  return {
    socials: SOCIALS.filter((p) => p.enabled()).map((p) => p.name),
    whop: whop.enabled(),
  };
}

async function postEverywhere(item, log = console.error) {
  const results = [];
  const errors = [];

  for (const platform of SOCIALS) {
    if (!platform.enabled()) continue;
    try {
      const r = await platform.post(item);
      results.push(r);
      log(`[post] ${platform.name} ✔ ${r.url || r.id || ""}`);
    } catch (e) {
      errors.push({ platform: platform.name, error: e.message });
      log(`[post] ${platform.name} ✖ ${e.message}`);
    }
  }

  // socials first, then the Whop community post linking to them
  if (whop.enabled()) {
    try {
      const r = await whop.post({ ...item, links: results.filter((r) => r.url) });
      results.push(r);
      log(`[post] whop ✔ ${r.id || ""}`);
    } catch (e) {
      errors.push({ platform: "whop", error: e.message });
      log(`[post] whop ✖ ${e.message}`);
    }
  }

  return { results, errors };
}

module.exports = { postEverywhere, enabledPlatforms };
