#!/usr/bin/env node
/**
 * Create Shopify online-store Pages (policies, FAQ, About, etc.) via the
 * Admin REST API. Uses a scoped token — never a password.
 *
 * SCOPES: needs write_content (a.k.a. online store pages). Add it alongside
 * write_products when creating the app, or update the app's Configuration.
 *
 * ENV:
 *   SHOPIFY_STORE   your-store.myshopify.com
 *   SHOPIFY_TOKEN   shpat_...
 *
 * USAGE:
 *   node post-pages.js --file ./pages.json [--dry-run] [--published]
 *
 * pages.json: [{ "title": "...", "body_html": "<p>…</p>", "handle": "optional" }]
 * Pages are created UNPUBLISHED by default; pass --published to make live.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : d;
};
const DRY = flag('dry-run');
const PUBLISHED = flag('published');
const FILE = opt('file', path.join(process.cwd(), 'pages.json'));
const STORE = process.env.SHOPIFY_STORE;
const TOKEN = process.env.SHOPIFY_TOKEN;
const API_VERSION = process.env.SHOPIFY_API_VERSION || '2024-10';

const die = (m) => {
  console.error(`✗ ${m}`);
  process.exit(1);
};

if (!fs.existsSync(FILE)) die(`pages file not found: ${FILE}`);
const PAGES = JSON.parse(fs.readFileSync(FILE, 'utf8'));
if (!Array.isArray(PAGES) || !PAGES.length) die('pages file must be a non-empty JSON array');
if (!DRY && (!STORE || !TOKEN)) die('Missing SHOPIFY_STORE / SHOPIFY_TOKEN (use --dry-run to preview)');

async function createPage(p, attempt = 1) {
  const url = `https://${STORE}/admin/api/${API_VERSION}/pages.json`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN },
    body: JSON.stringify({
      page: {
        title: p.title,
        body_html: p.body_html,
        handle: p.handle,
        published: PUBLISHED,
      },
    }),
  });
  if (res.status === 429 && attempt <= 5) {
    await new Promise((r) => setTimeout(r, 1000 * 2 ** (attempt - 1)));
    return createPage(p, attempt + 1);
  }
  if (res.status === 401) die('401 Unauthorized — bad/revoked token.');
  if (res.status === 403) die('403 — token missing write_content scope (add it and reinstall the app).');
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return (await res.json()).page;
}

(async () => {
  console.log(`\nShopify pages ${DRY ? '(DRY RUN)' : ''} — ${PAGES.length} pages, ${PUBLISHED ? 'PUBLISHED' : 'unpublished'}`);
  console.log('='.repeat(50));
  if (DRY) {
    PAGES.forEach((p) => console.log(`• ${p.title}  (${(p.body_html || '').length} chars)`));
    console.log(`\n${PAGES.length} pages would be created. Set env vars and re-run without --dry-run.`);
    return;
  }
  let ok = 0,
    fail = 0;
  for (const p of PAGES) {
    try {
      const page = await createPage(p);
      console.log(`  ✓ ${page.title} → /pages/${page.handle}`);
      ok++;
    } catch (e) {
      console.error(`  ✗ ${p.title}: ${e.message}`);
      fail++;
    }
  }
  console.log(`\n${'='.repeat(50)}\nDone. OK: ${ok}  Failed: ${fail}`);
  if (!PUBLISHED) console.log('Created unpublished — review, then publish in admin (or re-run with --published).');
})();
