#!/usr/bin/env node
/**
 * Shopify Admin API client — create/update products, attach images, manage
 * collections. Uses a scoped Admin API token (never a password).
 *
 * ENV:
 *   SHOPIFY_STORE   e.g. your-store.myshopify.com   (admin domain)
 *   SHOPIFY_TOKEN   shpat_...                         (write_products scope)
 *   SHOPIFY_API_VERSION  optional, defaults to a recent stable version
 *
 * USAGE:
 *   node shopify-api.js --dry-run                 # preview from products.json
 *   node shopify-api.js                           # create products (as DRAFT)
 *   node shopify-api.js --update                  # update existing (match by SKU/handle)
 *   node shopify-api.js --file ./my-products.json # custom catalog file
 *   node shopify-api.js --images ./png-exports    # image folder (default ./png-exports)
 *   node shopify-api.js --publish                 # create as ACTIVE instead of DRAFT
 *
 * Catalog file format (JSON array): see references/admin-api.md.
 * Requires Node 18+ (built-in fetch/FormData/Blob). `npm i sharp` only needed
 * for the separate image-conversion script.
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
const UPDATE = flag('update');
const PUBLISH = flag('publish');
const FILE = opt('file', path.join(process.cwd(), 'products.json'));
const IMG_DIR = opt('images', path.join(process.cwd(), 'png-exports'));
const STORE = process.env.SHOPIFY_STORE;
const TOKEN = process.env.SHOPIFY_TOKEN;
const API_VERSION = process.env.SHOPIFY_API_VERSION || '2024-10';

function die(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

if (!fs.existsSync(FILE)) {
  die(`Catalog file not found: ${FILE}\n  Create a products.json array or pass --file <path>.`);
}
const PRODUCTS = JSON.parse(fs.readFileSync(FILE, 'utf8'));
if (!Array.isArray(PRODUCTS) || PRODUCTS.length === 0) {
  die('Catalog file must be a non-empty JSON array of products.');
}

if (!DRY && (!STORE || !TOKEN)) {
  die('Missing SHOPIFY_STORE and/or SHOPIFY_TOKEN env vars. (Use --dry-run to preview without them.)');
}

const endpoint = STORE ? `https://${STORE}/admin/api/${API_VERSION}/graphql.json` : null;

// ── GraphQL helper with basic throttling/retry on Shopify rate limits ──────
async function gql(query, variables, attempt = 1) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN },
    body: JSON.stringify({ query, variables }),
  });
  if (res.status === 429 && attempt <= 5) {
    const wait = 1000 * 2 ** (attempt - 1);
    console.warn(`  …rate limited, retrying in ${wait}ms`);
    await new Promise((r) => setTimeout(r, wait));
    return gql(query, variables, attempt + 1);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (json.errors) throw new Error(`GraphQL: ${JSON.stringify(json.errors)}`);
  return json.data;
}

// ── Mutations ──────────────────────────────────────────────────────────────
const M_CREATE = `mutation($input:ProductInput!){productCreate(input:$input){product{id title handle}userErrors{field message}}}`;
const M_UPDATE = `mutation($input:ProductInput!){productUpdate(input:$input){product{id title handle}userErrors{field message}}}`;
const Q_BY_HANDLE = `query($q:String!){products(first:1,query:$q){edges{node{id handle}}}}`;
const M_STAGE = `mutation($input:[StagedUploadInput!]!){stagedUploadsCreate(input:$input){stagedTargets{url resourceUrl parameters{name value}}userErrors{field message}}}`;
const M_MEDIA = `mutation($id:ID!,$media:[CreateMediaInput!]!){productCreateMedia(productId:$id,media:$media){media{...on MediaImage{id}}mediaUserErrors{field message}}}`;

function buildInput(p, id) {
  const input = {
    title: p.title,
    descriptionHtml: p.descriptionHtml || p.description || '',
    productType: p.productType || '',
    vendor: p.vendor || '',
    tags: p.tags || [],
    status: PUBLISH ? 'ACTIVE' : 'DRAFT',
  };
  if (id) input.id = id;
  if (p.optionName) input.options = [p.optionName];
  if (p.variants) {
    input.variants = p.variants.map((v) => ({
      options: p.optionName ? [v.option] : undefined,
      sku: v.sku,
      price: String(v.price),
      weight: v.weight,
      weightUnit: v.weightUnit || 'POUNDS',
      inventoryItem: { tracked: v.tracked !== false },
    }));
  }
  return input;
}

async function findIdByHandle(handle) {
  const d = await gql(Q_BY_HANDLE, { q: `handle:${handle}` });
  const edge = d.products.edges[0];
  return edge ? edge.node.id : null;
}

async function attachImage(productId, file, alt) {
  const full = path.join(IMG_DIR, file);
  if (!fs.existsSync(full)) {
    console.warn(`  ⚠ image not found: ${file} — skipping`);
    return;
  }
  const bytes = fs.readFileSync(full);
  const staged = await gql(M_STAGE, {
    input: [{ filename: file, mimeType: 'image/png', httpMethod: 'POST', resource: 'IMAGE' }],
  });
  const target = staged.stagedUploadsCreate.stagedTargets[0];
  const form = new FormData();
  for (const par of target.parameters) form.append(par.name, par.value);
  form.append('file', new Blob([bytes], { type: 'image/png' }), file);
  const up = await fetch(target.url, { method: 'POST', body: form });
  if (!up.ok) throw new Error(`staged upload failed: HTTP ${up.status}`);
  await gql(M_MEDIA, {
    id: productId,
    media: [{ alt: alt || '', mediaContentType: 'IMAGE', originalSource: target.resourceUrl }],
  });
  console.log(`  ✓ image attached: ${file}`);
}

async function main() {
  console.log(`\nShopify ${UPDATE ? 'update' : 'create'}${DRY ? ' (DRY RUN)' : ''} — ${PRODUCTS.length} products`);
  console.log('='.repeat(56));

  if (DRY) {
    for (const p of PRODUCTS) {
      console.log(`\n• ${p.title}  [${p.productType || 'n/a'}]  status=${PUBLISH ? 'ACTIVE' : 'DRAFT'}`);
      (p.variants || []).forEach((v) =>
        console.log(`    - ${v.option || 'default'}: $${v.price}  (${v.sku || 'no-sku'})`)
      );
      if (p.image) console.log(`    image: ${p.image}`);
    }
    console.log(`\n${PRODUCTS.length} products would be ${UPDATE ? 'updated' : 'created'}.`);
    console.log('Set SHOPIFY_STORE + SHOPIFY_TOKEN and re-run without --dry-run.');
    return;
  }

  let ok = 0,
    fail = 0;
  for (const p of PRODUCTS) {
    try {
      console.log(`\n• ${UPDATE ? 'Updating' : 'Creating'}: ${p.title}`);
      let id = null;
      if (UPDATE) {
        id = p.id || (p.handle ? await findIdByHandle(p.handle) : null);
        if (!id) throw new Error('no matching product found (set handle or id)');
      }
      const data = await gql(UPDATE ? M_UPDATE : M_CREATE, { input: buildInput(p, id) });
      const node = UPDATE ? data.productUpdate : data.productCreate;
      if (node.userErrors.length) throw new Error(node.userErrors.map((e) => e.message).join('; '));
      const product = node.product;
      console.log(`  ✓ ${UPDATE ? 'updated' : 'created'} (${product.id})`);
      if (p.image) await attachImage(product.id, p.image, `${p.title} — product photo`);
      ok++;
    } catch (e) {
      console.error(`  ✗ ${e.message}`);
      fail++;
    }
  }
  console.log(`\n${'='.repeat(56)}\nDone. OK: ${ok}  Failed: ${fail}`);
  if (!PUBLISH) console.log('Created as DRAFT — review in admin, then set Active to publish.');
}

main().catch((e) => die(e.message));
