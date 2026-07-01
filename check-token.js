#!/usr/bin/env node
/**
 * Shopify Admin API token checker.
 *
 * Read-only sanity check before running the uploader: confirms your token
 * connects, reports the store name, lists the access scopes it was granted,
 * verifies write_products is present, and counts existing products.
 *
 * It never writes anything and never needs your password.
 *
 * USAGE:
 *   export SHOPIFY_STORE="pawlettes.myshopify.com"
 *   export SHOPIFY_TOKEN="shpat_..."
 *   node check-token.js
 */
'use strict';

const STORE = process.env.SHOPIFY_STORE;
const TOKEN = process.env.SHOPIFY_TOKEN;
const API_VERSION = process.env.SHOPIFY_API_VERSION || '2024-10';

function fail(msg) {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}

if (!STORE || !TOKEN) {
  fail(
    'Missing env vars.\n' +
      '  export SHOPIFY_STORE="your-store.myshopify.com"\n' +
      '  export SHOPIFY_TOKEN="shpat_..."'
  );
}
if (!/^shpat_/.test(TOKEN)) {
  console.warn('⚠ Token does not start with "shpat_" — Admin API tokens normally do.');
}
if (!/\.myshopify\.com$/.test(STORE)) {
  console.warn(`⚠ SHOPIFY_STORE should be the admin domain (…myshopify.com), got "${STORE}".`);
}

const endpoint = `https://${STORE}/admin/api/${API_VERSION}/graphql.json`;

const QUERY = `{
  shop { name myshopifyDomain primaryDomain { url } }
  productsCount: products { edges { node { id } } }
  currentAppInstallation { accessScopes { handle } }
}`;

async function gql(query) {
  let res;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN },
      body: JSON.stringify({ query }),
    });
  } catch (e) {
    fail(`Network error reaching ${STORE}: ${e.message}`);
  }
  if (res.status === 401) fail('401 Unauthorized — token is invalid, revoked, or for a different store.');
  if (res.status === 403) fail('403 Forbidden — token lacks the required scope (need write_products).');
  if (res.status === 404) fail(`404 — store "${STORE}" not found. Check the myshopify domain.`);
  if (!res.ok) fail(`HTTP ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (json.errors) fail(`GraphQL error: ${JSON.stringify(json.errors)}`);
  return json.data;
}

(async () => {
  console.log(`\nChecking token against ${STORE} …`);
  const d = await gql(QUERY);

  const scopes = (d.currentAppInstallation?.accessScopes || []).map((s) => s.handle);
  const hasWrite = scopes.includes('write_products');
  const count = (d.productsCount?.edges || []).length;

  console.log('\n' + '='.repeat(48));
  console.log(`✓ Connected`);
  console.log(`  Store:        ${d.shop?.name}`);
  console.log(`  Admin domain: ${d.shop?.myshopifyDomain}`);
  console.log(`  Storefront:   ${d.shop?.primaryDomain?.url}`);
  console.log(`  Scopes:       ${scopes.join(', ') || '(none reported)'}`);
  console.log(`  Products:     ${count}${count === 250 ? '+ (first page)' : ''}`);
  console.log('='.repeat(48));

  if (hasWrite) {
    console.log('\n✓ write_products present — you can run the uploader:');
    console.log('  node .claude/skills/shopify-store/scripts/shopify-api.js \\');
    console.log('       --file shopify-catalog.json --images png-exports\n');
  } else {
    console.log('\n✗ write_products NOT granted. In the app Configuration, add the');
    console.log('  write_products scope, Save, then reinstall the app and retry.\n');
    process.exit(2);
  }
})();
