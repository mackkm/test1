# Pawlettes → Shopify: Step-by-Step Upload Tutorial

This walks you all the way from zero to 8 live products on **pawlette.shop**.
Total hands-on time: about 15 minutes. No coding experience needed — you'll
just copy/paste a few commands.

There are two parts:
- **Part A** — Get your Admin API token (one-time, ~3 min, done in Shopify)
- **Part B** — Run the uploader (~5 min, done in your terminal)

> Why a token instead of your password? The token only allows product
> changes, never touches your email or password, and you can delete it the
> instant we're done. Never paste your real account password anywhere.

---

## Part A — Create your Admin API token

### A1. Open the developer apps area
1. Log in to your Shopify admin at **pawlettes.myshopify.com/admin**
   *(the admin URL stays on myshopify.com even though your store shows as pawlette.shop)*
2. In the bottom-left, click **Settings**
3. In the Settings menu, click **Apps and sales channels**
4. Click the **Develop apps** button (top right)
   - If it's your first time, click **Allow custom app development** → confirm

### A2. Create the app
1. Click **Create an app**
2. App name: `Product Importer`
3. App developer: leave as your account
4. Click **Create app**

### A3. Give it permission to add products
1. On the app page, click the **Configuration** tab
2. Under **Admin API integration**, click **Configure**
3. In the **Admin API access scopes** search box, type: `write_products`
4. Tick the box for **`write_products`** (this also includes read)
5. Click **Save** (top right)

### A4. Install and copy the token
1. Click the **API credentials** tab
2. Click **Install app** → confirm **Install**
3. Under **Admin API access token**, click **Reveal token once**
4. **Copy the token** — it starts with `shpat_`
   - ⚠️ Shopify shows it only once. Copy it now. If you lose it, you can
     uninstall/reinstall to get a new one.

You now have your token. Keep it handy for Part B.

---

## Part B — Run the uploader

You'll run these in a terminal, in the project folder (where this file lives).

### B1. Check Node.js is installed
```bash
node --version
```
- You need **v18 or higher**. If you see a version number ≥ 18, you're good.
- If not installed, get it from https://nodejs.org (LTS version).

### B2. Generate the product images (PNG)
The mockups are SVG; Shopify wants PNG. This converts all 8 at once:
```bash
npm install sharp
node convert-svgs-to-png.js
```
- This creates `products/png-exports/` with eight 1200×1200 PNGs.
- ✅ You should see "Conversion complete! Successful: 8".

### B3. Preview the upload (no token needed, changes nothing)
```bash
node upload-to-shopify.js --dry-run
```
- Confirms all 8 products, prices, and variants look right before anything
  is created. Nothing is sent to Shopify in dry-run mode.

### B4. Enter your store + token
Paste your token from Part A here (replace the `shpat_...` part):
```bash
export SHOPIFY_STORE="pawlettes.myshopify.com"
export SHOPIFY_TOKEN="shpat_paste_your_token_here"
```
- These only live in your current terminal session and vanish when you close it.
- (On Windows PowerShell use: `$env:SHOPIFY_STORE="..."` and `$env:SHOPIFY_TOKEN="..."`)

### B5. Run the real upload
```bash
node upload-to-shopify.js
```
- The script creates each product **as a draft** and attaches its image.
- ✅ You should see "Done. Created: 8  Failed: 0".

---

## Part C — Review & publish

1. In Shopify admin, go to **Products** — you'll see all 8 as **Draft**.
2. Click into a couple to confirm the image, description, and variants look right.
3. To publish: select all → **More actions** → **Set as active**
   *(or open each product and set Status → Active)*.
4. Visit **https://pawlette.shop** — your products are now live! 🎉

---

## Part D — Clean up (optional but recommended)

Once everything's uploaded and you don't plan to re-run the script:
1. Shopify admin → **Settings → Apps and sales channels → Develop apps**
2. Open **Product Importer** → **Delete app** (or **Uninstall**)
3. This instantly revokes the token. You can always recreate it later.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `Missing credentials` | You skipped B4 — run the two `export` lines, then retry B5. |
| `HTTP 401` / `Invalid API key or access token` | Token was mistyped or the app isn't installed. Recheck A4. |
| `403` / `access denied` | The `write_products` scope wasn't saved. Redo A3, then reinstall. |
| `Image not found … skipping image` | You skipped B2 — run `node convert-svgs-to-png.js` first. |
| `fetch is not defined` | Node is older than v18. Upgrade Node. |
| Product created but no image | Re-run; or add the image manually in the product's **Media** section. |
| Wrong store domain | `SHOPIFY_STORE` must be the **myshopify** admin domain, not pawlette.shop. |

---

## Quick reference (the whole thing in 6 commands)

```bash
# one-time image prep
npm install sharp
node convert-svgs-to-png.js

# preview
node upload-to-shopify.js --dry-run

# upload (after pasting your real token)
export SHOPIFY_STORE="pawlettes.myshopify.com"
export SHOPIFY_TOKEN="shpat_paste_your_token_here"
node upload-to-shopify.js
```

That's it. Eight products, images and all, live on pawlette.shop.
