---
name: shopify-store
description: >-
  Create and edit Shopify online stores — add or update products, variants,
  prices, images, and collections; bulk-import a catalog via CSV; and prep
  product images. Use when the user wants to build a Shopify store, add or edit
  products, bulk-upload a catalog, generate/convert product images, or connect
  sales channels for an existing myshopify.com / custom-domain store.
---

# Shopify Store Builder

Helps create and edit Shopify stores programmatically and safely. Covers the
full path: getting API access, creating/updating products and collections,
bulk CSV import, image preparation, and verification — without ever handling
the user's account password.

## Golden rules (read first)

1. **Never ask for or use the user's Shopify/email password.** All API work
   uses a scoped **Admin API access token** (`shpat_…`) the user creates and
   can revoke. The token cannot read email or change passwords.
2. **You cannot log into the user's Shopify admin or third-party accounts**
   (Meta, Google, TikTok, etc.) for them. Token creation and sales-channel
   OAuth happen in the user's own browser session. Provide exact steps; let
   them click.
3. **Default to non-destructive.** Create new products as `DRAFT` so the user
   reviews before publishing. Never bulk-delete or overwrite live products
   without explicit confirmation.
4. **Always dry-run first.** Preview what will be created/changed before any
   write call. Confirm counts and prices with the user.
5. The **admin domain stays `*.myshopify.com`** even when the public store uses
   a custom domain. API calls go to the myshopify domain.

## How the user gets an Admin API token

Walk the user through this once (it's ~30s and only they can do it):

1. Shopify admin → **Settings → Apps and sales channels → Develop apps**
2. **Create an app** (e.g. "Store Builder")
3. **Configuration → Admin API integration → Configure** → grant scopes:
   - `write_products` (create/edit products, variants, images)
   - `write_inventory` (only if adjusting stock levels)
   - add `write_publications` if managing channel publishing
4. **Save** → **API credentials** tab → **Install app**
5. **Reveal token once** → copy the `shpat_…` token (shown only once)

Then the token + store domain go into env vars — never into committed files:

```bash
export SHOPIFY_STORE="your-store.myshopify.com"
export SHOPIFY_TOKEN="shpat_xxxxxxxxxxxxxxxx"
```

## Two ways to load a catalog

| Method | When to use | Tooling |
|--------|-------------|---------|
| **CSV import** | Quick, no token, one-off catalog load | Shopify admin → Products → Import; build the file with `references/product-csv-format.md` |
| **Admin API** | Repeatable, scripted, attaches images, collections | `scripts/shopify-api.js` |

For an ongoing/automated workflow prefer the API. For a one-time load with no
token, the CSV path is fastest.

## Workflow: create or edit products via API

1. **Define products** in a JS/JSON array (title, description HTML, type, tags,
   options, variants with sku/price/weight, image filename).
2. **Prep images** → `scripts/products-to-png.js` converts SVG/source art to
   1200×1200 PNG in an exports folder. Shopify wants raster (PNG/JPG), square.
3. **Dry run** → `node scripts/shopify-api.js --dry-run` to preview.
4. **Create/update** → set env vars, then run without `--dry-run`. Products are
   created as drafts with images attached via staged uploads.
5. **Verify** → list products back from the API (the script prints created IDs)
   and have the user eyeball them in admin before publishing.

`scripts/shopify-api.js` supports:
- `create` (default) — create new products as drafts
- `--update` — update existing products matched by SKU/handle
- `--dry-run` — preview only, no API calls
- image attachment via `stagedUploadsCreate` + `productCreateMedia`

See `references/admin-api.md` for the GraphQL mutations and field reference.

## Workflow: editing an existing store

- **Edit copy/price/tags:** use `--update`; match on handle or variant SKU.
- **Add images to existing products:** `productCreateMedia` with the product's
  GID (the script has an `attach-image` mode).
- **Collections:** create/maintain with `collectionCreate` /
  `collectionAddProducts` (see `references/admin-api.md`).
- **Theme/storefront text:** content edits (pages, navigation, theme settings)
  are done in the admin Theme editor; the Admin API can edit theme assets via
  the Asset resource only for advanced cases — prefer the editor and give the
  user steps.

## Image preparation

- Source art can be SVG; convert to **PNG 1200×1200** (square, light/white bg).
- `scripts/products-to-png.js` uses `sharp` (`npm install sharp`).
- Keep files < 500 KB; add descriptive **alt text** on every image (SEO + a11y).

## Verification checklist

- [ ] Dry-run output matches intended catalog (counts, prices, variants)
- [ ] Images converted to valid 1200×1200 PNG
- [ ] Products created as DRAFT; user reviewed in admin
- [ ] Alt text set on images
- [ ] Prices, SKUs, weights correct
- [ ] Token revoked/app deleted if it was a one-time job

## Things to refuse or escalate

- Logging into the user's accounts or operating their live storefront for them.
- Spending money on their behalf (ads, domains, paid apps).
- Pasting real passwords anywhere — if the user shares one, tell them to rotate
  it and pivot to the token flow.
- Bulk destructive ops (delete all products, overwrite live catalog) without
  explicit, specific confirmation.

## Bundled files

- `scripts/shopify-api.js` — Admin GraphQL client: create/update products,
  attach images, manage collections; supports `--dry-run` / `--update`.
- `scripts/products-to-png.js` — convert source images to Shopify-ready PNGs.
- `references/admin-api.md` — GraphQL mutations, fields, gotchas.
- `references/product-csv-format.md` — Shopify CSV import column reference.
