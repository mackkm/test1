# Pawlettes Multi-Channel Strategy

Sell and market everywhere your customers already are — while keeping a single
source of truth for inventory and orders in Shopify. Every channel below syncs
back to your store, so you manage products and orders in one place.

> **Core idea:** Don't rebuild your catalog 6 times. Shopify "sales channels"
> push your existing products out to each platform and pull orders back in.
> Add a channel once; it stays in sync automatically.

---

## The channel map

| Channel | Type | Best for | Effort | Cost |
|---------|------|----------|--------|------|
| **Online store (pawlette.shop)** | Sell | Your hub — owns the customer | Live ✅ | — |
| **Instagram + Facebook Shop** | Sell + market | Visual products, dog community | Low | Free + ad spend |
| **TikTok Shop** | Sell + market | Viral reach, younger buyers | Med | Free + commission |
| **Google (Shopping + free listings)** | Market | High-intent search ("dog lick mat") | Low | Free + optional ads |
| **Pinterest** | Market | Gift/idea discovery, long shelf life | Low | Free + ad spend |
| **Email + SMS (Shopify Email/Klaviyo)** | Market | Repeat sales, abandoned carts | Low | Cheap, high ROI |
| **Shop app** | Sell | Mobile shoppers, repeat buyers | Very low | Free |
| **Amazon / eBay** | Sell | Marketplace reach, trust | High | Fees/commission |
| **Shopify POS** | Sell | Pop-ups, markets, fairs | Med | Free app + reader |

**Priority order for a small store (do them in this sequence):**
1. Email + SMS (owns your audience, highest ROI) →
2. Instagram/Facebook Shop (you're already running Meta ads) →
3. Google free listings + Shopping →
4. Pinterest →
5. TikTok Shop →
6. Marketplaces (Amazon) once you have reviews & margin.

---

## 1. Email + SMS — start here (highest ROI)

You own this list forever; no algorithm in between. Even a small list beats
paid ads on return.

**Setup (Shopify Email — built in, free up to 10k emails/mo):**
1. Shopify admin → **Marketing → Create campaign → Shopify Email**
2. Add a newsletter signup to your storefront (theme → **Footer** → email signup)
3. Offer **10% off first order** for signing up (Settings → Discounts → create code `WELCOME10`)

**The 4 automations that print money** (Shopify → Marketing → Automations):
- **Welcome series** — triggered on signup, deliver the 10% code
- **Abandoned checkout** — recover ~10% of lost carts (single biggest win)
- **Post-purchase** — thank-you + care tips + cross-sell (e.g. bought a harness → suggest LED collar)
- **Win-back** — "we miss your pup" to customers who haven't ordered in 60 days

**SMS:** add Shopify's SMS or an app like Postscript for order updates + flash
sales (very high open rates — use sparingly).

---

## 2. Instagram + Facebook Shop

You're already advertising on Meta — turn that traffic into a shoppable
storefront so people buy without leaving the app.

1. Shopify admin → **Settings → Apps and sales channels → Facebook & Instagram**
2. Connect your Meta Business account + the **Pawlettes Pixel** (see META-PIXEL-SETUP.md)
3. Enable **Shopping** → your catalog syncs to a Facebook/Instagram Shop
4. **Tag products** in posts, Reels, and Stories → taps go straight to checkout
5. Turn on **Instagram Shopping tags** in the IG app (Settings → Business → Shopping)

**Content cadence:** 3–5 posts/week mixing product, dogs using products (UGC),
and behind-the-scenes. Reels > static posts for reach.

---

## 3. Google — free listings + Shopping

Captures people actively searching to buy ("personalized dog bandana").

1. Shopify admin → **Settings → Apps and sales channels → Google & YouTube**
2. Connect a **Google Merchant Center** account → catalog syncs
3. Enable **free listings** (zero cost, appears in the Shopping tab)
4. Optionally run a **Performance Max** Shopping campaign when budget allows
5. Make sure products have clear titles, the PNG images, and GTIN/“no GTIN” set

**SEO bonus:** your product descriptions (already keyword-rich in
PRODUCT_CATALOG.md) help you rank organically too.

---

## 4. Pinterest

Pins have a long life and Pinterest skews toward gift/idea shoppers — ideal for
personalized portraits, bandanas, and dog-parent apparel.

1. Install the **Pinterest** app from the Shopify App Store → connect a business account
2. Enable **catalog sync** → products become shoppable **Product Pins**
3. Verify your domain + add the Pinterest tag (parallels the Meta pixel)
4. Create themed boards: "Gifts for Dog Lovers", "Custom Pet Portraits", "Dog Walk Essentials"

---

## 5. TikTok Shop

Highest viral upside, but reward is for native short video, not static images.

1. Shopify App Store → **TikTok** app → connect TikTok For Business
2. Enable **TikTok Shop** (where eligible) → catalog syncs, in-app checkout
3. Post short vertical videos: unboxings, "before/after" (deshedding glove,
   paw cleaner), the LED collar glowing at night
4. Use trending sounds; let creators tag products via affiliate/Shop links

> See the earlier conversation note: TikTok creative must be native vertical
> video — your product mockups work as slideshow frames but real footage wins.

---

## 6. Shop app

Free, near-zero effort. Your store gets a mobile presence and buyers can track
orders + reorder in one tap.

1. Shopify admin → **Settings → Apps and sales channels → Shop**
2. Enable the channel and customize your Shop profile
3. Turn on **Shop Pay** at checkout (faster conversions across all channels)

---

## 7. Marketplaces (Amazon / eBay) — later

More reach and built-in trust, but fees and stricter rules. Best once you have
reviews and confirmed margins.

- Use a Shopify integration app (e.g. **Amazon by Codisto** / marketplace
  connectors) to list and sync inventory.
- Reserve a few hero SKUs rather than the whole catalog to start.
- Note personalized items (portraits, engraved tags, embroidered apparel) are
  harder on marketplaces — keep those exclusive to pawlette.shop.

---

## 8. In-person — Shopify POS

For weekend markets, pop-ups, and pet expos.

1. Add the **Point of Sale** channel + order a card reader
2. Same inventory syncs — sell in person, stock updates everywhere
3. Capture emails at the booth to grow the list (feeds Channel #1)

---

## Keeping it all in sync (don't skip)

- **One inventory:** every channel reads/writes the same Shopify stock — no overselling.
- **Consistent branding:** same product photos (your PNGs), tone, and pricing everywhere.
- **One pixel/tag per platform:** Meta Pixel, Google tag, Pinterest tag, TikTok pixel — install each once.
- **UTM tracking:** tag campaign links so you know which channel drives sales
  (Shopify → Analytics → Marketing report).

---

## 30-day rollout plan

| Week | Focus |
|------|-------|
| **1** | Email/SMS: signup form, WELCOME10, abandoned-cart + welcome automations |
| **2** | Instagram/Facebook Shop live + product tagging; start posting Reels 3x/wk |
| **3** | Google Merchant Center + free listings; Pinterest catalog + 3 boards |
| **4** | TikTok Shop + first 3 native videos; review Analytics, double down on the winning channel |

---

## What only you can do

Each channel connection requires logging into **your** accounts (Meta, Google,
Pinterest, TikTok) and approving the link — those are yours to authorize. This
guide gives the exact Shopify path and settings so each is a quick connect-and-sync.
I can't log into or post on those platforms for you, but I can draft the
content (post captions, email copy, video scripts) for any channel you want to
prioritize — just say which.
