#!/usr/bin/env node

/**
 * Pawlettes → Shopify product uploader
 *
 * Creates all products (with variants and images) in your Shopify store
 * using the Admin GraphQL API. It never handles your password — it uses a
 * scoped Admin API access token that you create and can revoke at any time.
 *
 * ── ONE-TIME SETUP ──────────────────────────────────────────────────────
 * 1. Shopify admin → Settings → Apps and sales channels → Develop apps
 * 2. Create an app (e.g. "Product Importer")
 * 3. Configuration → grant the "write_products" scope → Save
 * 4. Install app → copy the Admin API access token (starts with "shpat_")
 *
 * ── RUN ─────────────────────────────────────────────────────────────────
 *   export SHOPIFY_STORE="pawlettes.myshopify.com"   # your admin domain
 *   export SHOPIFY_TOKEN="shpat_xxxxxxxxxxxxxxxxxxxx" # the token from above
 *   node upload-to-shopify.js
 *
 * Add --dry-run to preview what would be created without calling the API:
 *   node upload-to-shopify.js --dry-run
 *
 * Requires Node 18+ (uses the built-in fetch). No npm install needed.
 */

const fs = require('fs');
const path = require('path');

const STORE = process.env.SHOPIFY_STORE;
const TOKEN = process.env.SHOPIFY_TOKEN;
const DRY_RUN = process.argv.includes('--dry-run');
const API_VERSION = '2024-10';

if (!DRY_RUN && (!STORE || !TOKEN)) {
  console.error('✗ Missing credentials.\n');
  console.error('  Set these environment variables first:');
  console.error('    export SHOPIFY_STORE="pawlettes.myshopify.com"');
  console.error('    export SHOPIFY_TOKEN="shpat_..."');
  console.error('\n  Or preview without uploading:  node upload-to-shopify.js --dry-run');
  process.exit(1);
}

const endpoint = `https://${STORE}/admin/api/${API_VERSION}/graphql.json`;

/**
 * Product definitions. Images point at the PNG exports produced by
 * convert-svgs-to-png.js (run that first). Each product is created as a
 * draft so you can review before publishing.
 */
const PRODUCTS = [
  {
    title: 'Slow-Down Lick Mat',
    productType: 'Feeding & Mealtime',
    tags: ['slow feeding', 'lick mat', 'dog enrichment', 'interactive'],
    descriptionHtml:
      "<p>Mealtime shouldn't be a 10-second inhale. The Slow-Down Lick Mat turns gulping into gentle, calming enrichment.</p><ul><li>Food-grade, BPA-free silicone</li><li>Textured ridges slow eating</li><li>Dishwasher &amp; freezer safe</li><li>Non-slip base</li></ul>",
    image: '1-lick-mat.png',
    optionName: 'Color',
    variants: [
      { option: 'Pink', sku: 'PAWL-001-PINK', price: '18.00', weight: 0.19 },
      { option: 'Blue', sku: 'PAWL-001-BLUE', price: '18.00', weight: 0.19 },
      { option: 'Yellow', sku: 'PAWL-001-YELLOW', price: '18.00', weight: 0.19 },
    ],
  },
  {
    title: 'Reversible Pet Bandana',
    productType: 'Apparel & Accessories',
    tags: ['pet bandana', 'personalized', 'custom embroidery', 'dog fashion'],
    descriptionHtml:
      "<p>Two looks, one bandana, and your best friend's name stitched right where everyone can see it.</p><ul><li>Reversible two-pattern design</li><li>Custom name embroidery (up to 15 characters)</li><li>Cotton blend, machine washable</li></ul>",
    image: '2-reversible-bandana.png',
    optionName: 'Personalization',
    variants: [
      { option: 'Custom with Name', sku: 'PAWL-002-CUSTOM', price: '24.00', weight: 0.05 },
    ],
  },
  {
    title: 'Quick-Dip Paw Cleaner',
    productType: 'Grooming & Cleaning',
    tags: ['paw cleaner', 'mud removal', 'portable', 'dog grooming'],
    descriptionHtml:
      '<p>Muddy walks, clean floors. The Quick-Dip Paw Cleaner gently washes away mud, sand, and dirt with a simple dip.</p><ul><li>Soft silicone bristles</li><li>20 oz capacity</li><li>Dishwasher safe</li></ul>',
    image: '3-paw-cleaner.png',
    optionName: 'Color',
    variants: [
      { option: 'Blush Pink', sku: 'PAWL-003-PINK', price: '24.00', weight: 0.25 },
      { option: 'Sage Green', sku: 'PAWL-003-GREEN', price: '24.00', weight: 0.25 },
    ],
  },
  {
    title: 'Pup Tee',
    productType: 'Apparel & Accessories',
    tags: ['t-shirt', 'custom dog', 'personalized', 'dog parent'],
    descriptionHtml:
      "<p>Wear your best friend over your heart. The Pup Tee turns your pet's name into wearable love.</p><ul><li>100% combed cotton</li><li>Custom name print</li><li>Pre-shrunk, tag-free</li></ul>",
    image: '4-pup-tee.png',
    optionName: 'Size',
    variants: [
      { option: 'XS', sku: 'PAWL-004-XS', price: '28.00', weight: 0.15 },
      { option: 'M', sku: 'PAWL-004-M', price: '28.00', weight: 0.15 },
      { option: 'L', sku: 'PAWL-004-L', price: '28.00', weight: 0.15 },
    ],
  },
  {
    title: 'Personalized Dog Parent Crewneck',
    productType: 'Apparel & Accessories',
    tags: ['crewneck', 'sweatshirt', 'custom embroidery', 'dog parent'],
    descriptionHtml:
      '<p>For the person whose whole heart answers to a wagging tail. A cozy crewneck with custom embroidery.</p><ul><li>Heavyweight cotton-poly blend</li><li>Brushed fleece interior</li><li>Custom embroidered name</li></ul>',
    image: '5-dog-parent-crewneck.png',
    optionName: 'Size',
    variants: [
      { option: 'M', sku: 'PAWL-005-M', price: '42.00', weight: 0.4 },
      { option: 'L', sku: 'PAWL-005-L', price: '42.00', weight: 0.4 },
    ],
  },
  {
    title: 'No-Pull Walk Harness',
    productType: 'Training & Walking',
    tags: ['harness', 'no-pull', 'dog training', 'walking'],
    descriptionHtml:
      "<p>Walks should be the best part of your dog's day, not a tug-of-war. Front-clip no-pull design.</p><ul><li>Padded neoprene</li><li>Adjustable, up to 90 lbs</li><li>Reflective strips</li></ul>",
    image: '6-no-pull-harness.png',
    optionName: 'Size',
    variants: [
      { option: 'Medium', sku: 'PAWL-006-M', price: '32.00', weight: 0.5 },
      { option: 'Large', sku: 'PAWL-006-L', price: '32.00', weight: 0.5 },
    ],
  },
  {
    title: 'Magic Deshedding Glove',
    productType: 'Grooming & Shedding',
    tags: ['deshedding glove', 'grooming', 'shedding brush', 'dog grooming'],
    descriptionHtml:
      '<p>One loving stroke is all it takes. Turns everyday cuddles into a productive grooming session.</p><ul><li>Soft silicone bristles</li><li>Fits most hands</li><li>Rinse-clean, machine washable</li></ul>',
    image: '7-deshedding-glove.png',
    optionName: 'Color',
    variants: [
      { option: 'Blue', sku: 'PAWL-007-BLUE', price: '16.00', weight: 0.06 },
      { option: 'Pink', sku: 'PAWL-007-PINK', price: '16.00', weight: 0.06 },
    ],
  },
  {
    title: 'LED Glow Safety Collar',
    productType: 'Safety & Visibility',
    tags: ['LED collar', 'glow collar', 'safety', 'visibility', 'night walks'],
    descriptionHtml:
      '<p>When the sun goes down, every walk should still feel safe. Visible up to 1000 feet.</p><ul><li>Multiple light modes</li><li>USB-C rechargeable, 60+ hr battery</li><li>IPX4 water resistant</li></ul>',
    image: '8-led-collar.png',
    optionName: 'Color',
    variants: [
      { option: 'Safety Red', sku: 'PAWL-008-RED', price: '26.00', weight: 0.16 },
      { option: 'Navy', sku: 'PAWL-008-NAVY', price: '26.00', weight: 0.16 },
    ],
  },
  {
    title: 'Custom Pet Portrait',
    productType: 'Personalized & Gifts',
    tags: ['custom portrait', 'pet portrait', 'personalized', 'gift'],
    descriptionHtml:
      '<p>Your best friend, immortalized. Upload a favorite photo and we hand-craft a custom illustrated portrait — printed to order on premium paper, ready to frame.</p><ul><li>Made from your uploaded photo</li><li>Premium print, made the day you order</li><li>A keepsake (or the perfect gift)</li></ul>',
    image: '9-custom-portrait.png',
    optionName: 'Format',
    variants: [
      { option: 'Print', sku: 'PAWL-009-PRINT', price: '35.00', weight: 0.2 },
      { option: 'Mug', sku: 'PAWL-009-MUG', price: '28.00', weight: 0.8 },
      { option: 'Tote', sku: 'PAWL-009-TOTE', price: '30.00', weight: 0.3 },
    ],
  },
  {
    title: 'Calming Donut Bed',
    productType: 'Comfort & Rest',
    tags: ['dog bed', 'calming bed', 'donut bed', 'anxiety'],
    descriptionHtml:
      '<p>The hug your dog curls up in. The plush raised rim supports the head and neck for deep, anxiety-easing sleep, while the soft filled center cradles them like a cloud.</p><ul><li>Faux-fur, machine washable</li><li>Raised rim for sense of security</li><li>Non-slip base</li></ul>',
    image: '10-calming-donut-bed.png',
    optionName: 'Size',
    variants: [
      { option: 'Small', sku: 'PAWL-010-S', price: '48.00', weight: 1.8 },
      { option: 'Medium', sku: 'PAWL-010-M', price: '58.00', weight: 2.4 },
      { option: 'Large', sku: 'PAWL-010-L', price: '68.00', weight: 3.2 },
    ],
  },
  {
    title: 'Snuffle Mat Puzzle Feeder',
    productType: 'Feeding & Mealtime',
    tags: ['snuffle mat', 'puzzle feeder', 'enrichment', 'slow feeding'],
    descriptionHtml:
      "<p>Turn mealtime into a nose-led treasure hunt. Hide kibble or treats in the soft fabric strips and let your dog's natural foraging instincts do the rest — calming, tiring, and fun.</p><ul><li>Engages natural foraging instincts</li><li>Reduces boredom and anxiety</li><li>Machine washable</li></ul>",
    image: '11-snuffle-mat.png',
    optionName: 'Color',
    variants: [
      { option: 'Teal', sku: 'PAWL-011-TEAL', price: '29.00', weight: 0.5 },
    ],
  },
  {
    title: 'Travel Bowl & Water Bottle',
    productType: 'Travel & Outdoors',
    tags: ['travel bottle', 'water bottle', 'portable bowl', 'outdoors'],
    descriptionHtml:
      '<p>Hydration on the go, no spills, no fuss. Press the button and water flows into the attached fold-out bowl; release and any unused water flows back in. Perfect for walks, hikes, and road trips.</p><ul><li>Leak-proof one-handed operation</li><li>Attached fold-out bowl</li><li>BPA-free, 19 oz capacity</li></ul>',
    image: '12-travel-bottle.png',
    optionName: 'Color',
    variants: [
      { option: 'Blue', sku: 'PAWL-012-BLUE', price: '22.00', weight: 0.4 },
      { option: 'Pink', sku: 'PAWL-012-PINK', price: '22.00', weight: 0.4 },
    ],
  },
  {
    title: 'Personalized Pet ID Tag',
    productType: 'Safety & Visibility',
    tags: ['ID tag', 'personalized', 'pet tag', 'engraved'],
    descriptionHtml:
      "<p>Peace of mind they wear every day. Deep-engraved with your pet's name and your phone number so they're never truly lost. Durable, quiet, and won't fade.</p><ul><li>Custom laser engraving (both sides)</li><li>Rust-proof stainless / brass</li><li>Includes split ring</li></ul>",
    image: '13-id-tag.png',
    optionName: 'Shape',
    variants: [
      { option: 'Bone', sku: 'PAWL-013-BONE', price: '14.00', weight: 0.05 },
      { option: 'Round', sku: 'PAWL-013-ROUND', price: '14.00', weight: 0.05 },
    ],
  },
];

const PNG_DIR = path.join(__dirname, 'products', 'png-exports');

async function graphql(query, variables, attempt = 1) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': TOKEN,
    },
    body: JSON.stringify({ query, variables }),
  });

  // Back off and retry on Shopify rate limiting (cost-based throttling).
  if (res.status === 429 && attempt <= 5) {
    const wait = 1000 * 2 ** (attempt - 1);
    console.warn(`  …rate limited, retrying in ${wait}ms`);
    await new Promise((r) => setTimeout(r, wait));
    return graphql(query, variables, attempt + 1);
  }

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${await res.text()}`);
  }
  const json = await res.json();
  if (json.errors) {
    throw new Error(`GraphQL error: ${JSON.stringify(json.errors)}`);
  }
  return json.data;
}

const CREATE_PRODUCT = `
  mutation productCreate($input: ProductInput!, $media: [CreateMediaInput!]) {
    productCreate(input: $input, media: $media) {
      product { id title handle }
      userErrors { field message }
    }
  }
`;

// Note: image media via productCreate requires a publicly reachable URL.
// Local PNGs are uploaded separately through staged uploads (see uploadImage).
const STAGED_UPLOADS_CREATE = `
  mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets { url resourceUrl parameters { name value } }
      userErrors { field message }
    }
  }
`;

const CREATE_MEDIA = `
  mutation productCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
    productCreateMedia(productId: $productId, media: $media) {
      media { ... on MediaImage { id } }
      mediaUserErrors { field message }
    }
  }
`;

async function uploadImage(productId, imageFile, altText) {
  const filePath = path.join(PNG_DIR, imageFile);
  if (!fs.existsSync(filePath)) {
    console.warn(`  ⚠ Image not found: ${imageFile} (run convert-svgs-to-png.js first) — skipping image`);
    return;
  }

  const fileBytes = fs.readFileSync(filePath);

  // 1. Ask Shopify for a staged upload target
  const staged = await graphql(STAGED_UPLOADS_CREATE, {
    input: [
      {
        filename: imageFile,
        mimeType: 'image/png',
        httpMethod: 'POST',
        resource: 'IMAGE',
      },
    ],
  });
  const target = staged.stagedUploadsCreate.stagedTargets[0];

  // 2. POST the file bytes to the staged target
  const form = new FormData();
  for (const p of target.parameters) form.append(p.name, p.value);
  form.append('file', new Blob([fileBytes], { type: 'image/png' }), imageFile);
  const uploadRes = await fetch(target.url, { method: 'POST', body: form });
  if (!uploadRes.ok) {
    throw new Error(`Staged upload failed: HTTP ${uploadRes.status}`);
  }

  // 3. Attach the uploaded image to the product
  await graphql(CREATE_MEDIA, {
    productId,
    media: [
      {
        alt: altText,
        mediaContentType: 'IMAGE',
        originalSource: target.resourceUrl,
      },
    ],
  });
  console.log(`  ✓ Image attached: ${imageFile}`);
}

async function createProduct(p) {
  const input = {
    title: p.title,
    descriptionHtml: p.descriptionHtml,
    productType: p.productType,
    vendor: 'Pawlettes',
    tags: p.tags,
    status: 'DRAFT', // created as draft for review; flip to ACTIVE when ready
    options: [p.optionName],
    variants: p.variants.map((v) => ({
      options: [v.option],
      sku: v.sku,
      price: v.price,
      weight: v.weight,
      weightUnit: 'POUNDS',
      inventoryItem: { tracked: true },
    })),
  };

  const data = await graphql(CREATE_PRODUCT, { input });
  const errs = data.productCreate.userErrors;
  if (errs && errs.length) {
    throw new Error(errs.map((e) => `${e.field}: ${e.message}`).join('; '));
  }
  return data.productCreate.product;
}

(async () => {
  console.log(`\nPawlettes → Shopify uploader${DRY_RUN ? ' (DRY RUN)' : ''}`);
  console.log('='.repeat(50));

  if (DRY_RUN) {
    for (const p of PRODUCTS) {
      console.log(`\n• ${p.title}  [${p.productType}]`);
      for (const v of p.variants) {
        console.log(`    - ${v.option}: $${v.price}  (SKU ${v.sku})`);
      }
      console.log(`    image: ${p.image}`);
    }
    console.log(`\n${PRODUCTS.length} products would be created (as drafts).`);
    console.log('Set SHOPIFY_STORE and SHOPIFY_TOKEN, then run without --dry-run.');
    return;
  }

  let ok = 0;
  let fail = 0;
  for (const p of PRODUCTS) {
    try {
      console.log(`\n• Creating: ${p.title}`);
      const product = await createProduct(p);
      console.log(`  ✓ Created (${product.id})`);
      await uploadImage(product.id, p.image, `${p.title} — Pawlettes product photo`);
      ok++;
    } catch (err) {
      console.error(`  ✗ Failed: ${err.message}`);
      fail++;
    }
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Done. Created: ${ok}  Failed: ${fail}`);
  console.log('Products were created as DRAFTS — review them in Shopify admin,');
  console.log('then set each to Active (or bulk-activate) to publish to pawlette.shop.');
})();
