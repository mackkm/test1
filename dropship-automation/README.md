# Pawlette dropshipping automation

Turnkey order-fulfillment automation for a Shopify store. It does three things:

1. **Imports** a supplier's catalog into Shopify as products, with a configurable price markup.
2. **Auto-fulfils**: when a customer's order is paid on Shopify, it automatically places the matching order with the supplier and ships to the customer's address.
3. **Syncs back**: tracking numbers and stock/price changes flow back into Shopify automatically, so the customer gets shipping notifications and you don't oversell out-of-stock items.

Supplier integration ships with **Printful** (print-on-demand) wired up, since a "Pawlette" pet brand fits custom-branded pet apparel/accessories well. Everything talks to suppliers through one `SupplierAdapter` interface (`src/suppliers/types.ts`), so adding CJdropshipping, Spocket, etc. later is a new adapter file, not a rewrite.

**Nothing in this codebase touches your live store by itself.** It needs real credentials in a `.env` file (next section) before any of the scripts or the server can do anything.

## Important caveats before you go live

- **I could not verify the Printful field names against live docs while building this** (`developers.printful.com` returned a 403 to automated fetches) and Printful has since introduced a v2 API that may have superseded what's here. Before relying on this for real orders: run `npm run import-products` once against a Printful **test/sandbox** product and check the created Shopify product looks right, then place one real test order and confirm a Printful order actually gets created with the correct address before turning it loose on real customers.
- **Adding a brand-new variant to an already-imported product isn't automated** (see the warning logged by `import-products` if this happens) - re-importing only updates price/stock on variants it already knows about. Fine for "import once, then keep in sync," not yet for "add a new size mid-catalog."
- This uses a single JSON file (`data/store.json`) as its database. That's intentional for a small single-supplier store (no DB to provision), but it means **don't run more than one instance of this server at a time** - concurrent writers would race.
- Shopify's built-in abandoned-cart emails and basic marketing are not part of this - they're already available in Shopify admin without any custom code.

## 1. Create a Shopify custom app

In your Shopify admin: **Settings → Apps and sales channels → Develop apps → Create an app**.

1. Give it a name (e.g. "Dropship Automation").
2. Under **Configuration**, grant Admin API scopes: `read_products`, `write_products`, `read_orders`, `write_orders`.
3. Click **Install app**, then go to **API credentials** and copy:
   - The **Admin API access token** (shown once - save it now) → `SHOPIFY_ADMIN_API_ACCESS_TOKEN`
   - The **API secret key** → `SHOPIFY_API_SECRET` (used to verify webhook signatures)

## 2. Get a Printful API key

Printful dashboard → **Stores** → choose/create your store → **API** → generate a key → `PRINTFUL_API_KEY`.

Design your products in Printful first (mockups, sizes, etc.) - this automation imports whatever's already in your Printful store, it doesn't design products for you.

## 3. Configure

```bash
cp .env.example .env
# fill in SHOPIFY_SHOP, SHOPIFY_ADMIN_API_ACCESS_TOKEN, SHOPIFY_API_SECRET, PRINTFUL_API_KEY
npm install
```

Set `MARKUP_MULTIPLIER` to whatever multiple of Printful's cost price you want to charge (default 2.5x).

## 4. Import your catalog

```bash
npm run import-products
```

Creates a Shopify product per Printful sync product, with variants priced at cost × markup, and records the mapping in `data/store.json` so future runs update instead of duplicating.

## 5. Deploy the server somewhere it can stay running

The webhook listener needs a stable public URL. Build and run with Docker:

```bash
docker build -t pawlette-automation .
docker run -p 3000:3000 --env-file .env -v $(pwd)/data:/app/data pawlette-automation
```

Deploy that image anywhere that runs containers (Cloud Run, Render, Railway, Fly.io, a VM). Mount a persistent volume at `/app/data` so `store.json` survives restarts.

Set `PUBLIC_BASE_URL` in `.env` to wherever it ends up (e.g. `https://pawlette-automation.example.com`).

## 6. Register the webhooks

Once deployed and `PUBLIC_BASE_URL` is set:

```bash
npm run register-webhooks
```

This registers a Shopify `orders/paid` webhook pointing at your server. Orders only get routed to the supplier once payment has actually cleared, so a cancelled/unpaid order never gets ordered from Printful.

Optionally, in Printful's dashboard, add a webhook for the `package_shipped` event pointing at:
`https://<your-host>/webhooks/printful/events?token=<PRINTFUL_WEBHOOK_SECRET>`
(set `PRINTFUL_WEBHOOK_SECRET` in `.env` to any random string first - it's a shared-secret check in the URL itself, since Printful's signature scheme couldn't be verified against live docs while building this). This makes tracking sync near-instant; without it, the built-in polling job (every 5 minutes) still catches it.

## What runs automatically once deployed

- `orders/paid` webhook → places the supplier order, address mapped from the Shopify order.
- Every 5 minutes → re-checks any open supplier order's status and pushes tracking numbers to Shopify as they ship (this is what triggers Shopify's "your order has shipped" email to the customer).
- Every `INVENTORY_SYNC_INTERVAL_MINUTES` (default 60) → re-pulls the supplier catalog and updates Shopify prices/stock for anything that changed.

## Manual commands

| Command | What it does |
|---|---|
| `npm run import-products` | Pull supplier catalog → create/update Shopify products |
| `npm run sync-inventory` | One-off price/stock sync (also runs on a timer inside the server) |
| `npm run register-webhooks` | Register the Shopify `orders/paid` webhook |
| `npm test` | Run the test suite (HMAC verification, pricing, order routing - all mocked, no live API calls) |
| `npm run dev` | Run the server locally with auto-reload |

## Adding another supplier

Implement `SupplierAdapter` (`src/suppliers/types.ts`) - `fetchCatalog`, `createOrder`, `getOrderStatus` - in a new file under `src/suppliers/`, then register it in `src/suppliers/registry.ts`. Everything else (webhook routing, pricing, inventory sync, the database) is supplier-agnostic.
