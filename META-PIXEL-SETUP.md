# Meta Pixel Setup for pawlette.shop

The Meta Pixel is a small tracking snippet that reports visitor actions
(page views, add-to-carts, purchases) back to Meta. It powers conversion
tracking, retargeting (showing ads to people who clicked but didn't buy), and
better ad optimization.

> **Your Pixel ID is unique to your account** — Meta generates it when you
> create the pixel (Step 1). It's a ~15-digit number. Everywhere below that
> says `YOUR_PIXEL_ID`, replace it with that number.

There are two ways to install it. **Option A (Shopify native) is recommended**
— it's no-code and auto-fires all the e-commerce events. Use Option B only if
you want manual control.

---

## Step 1 — Create your Pixel & get its ID

1. Go to **business.facebook.com/events_manager**
2. Click **Connect data sources** → **Web** → **Connect**
3. Name it `Pawlettes Pixel` → **Create**
4. Your **Pixel ID** now shows at the top of the data source (a long number).
   Copy it — you'll need it below.

---

## Option A — Shopify native integration (recommended, no code)

This connects the pixel through Shopify's official channel, which
automatically tracks PageView, ViewContent, AddToCart, InitiateCheckout, and
Purchase — no snippet editing, and it survives theme updates.

1. In Shopify admin: **Settings → Apps and sales channels**
2. Search the Shopify App Store for **Facebook & Instagram** → **Add channel**
3. Open the channel → **Settings / Connect account**
4. Connect your Facebook account and your **Business / Meta Business Portfolio**
5. Under **Data sharing**, choose a level:
   - **Maximum** (recommended) — enables the Conversions API (server-side)
     alongside the pixel for more reliable tracking despite ad blockers/iOS
6. Select your **Pawlettes Pixel** from the dropdown
7. **Save / Finish setup**

✅ That's it. Skip to **Step 3 — Verify**.

---

## Option B — Manual install (base code + events)

Use this only if you're not using the Facebook channel. You'll paste the base
code into your theme, and Shopify's checkout fires events via Customer Events.

### B1. Add the base code (fires PageView on every page)

In Shopify admin: **Online Store → Themes → ⋯ → Edit code**, open
`layout/theme.liquid`, and paste this **just before the closing `</head>`**:

```html
<!-- Meta Pixel Code -->
<script>
  !function(f,b,e,v,n,t,s)
  {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
  n.callMethod.apply(n,arguments):n.queue.push(arguments)};
  if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
  n.queue=[];t=b.createElement(e);t.async=!0;
  t.src=v;s=b.getElementsByTagName(e)[0];
  s.parentNode.insertBefore(t,s)}(window, document,'script',
  'https://connect.facebook.net/en_US/fbevents.js');
  fbq('init', 'YOUR_PIXEL_ID');
  fbq('track', 'PageView');
</script>
<noscript><img height="1" width="1" style="display:none"
  src="https://www.facebook.com/tr?id=YOUR_PIXEL_ID&ev=PageView&noscript=1"/></noscript>
<!-- End Meta Pixel Code -->
```

Replace **both** instances of `YOUR_PIXEL_ID` with your real ID, then **Save**.

### B2. Add standard e-commerce events (via Customer Events)

Shopify routes purchase/checkout data through **Settings → Customer events →
Add custom pixel**. Create a custom pixel named `Meta Events` and paste:

```js
// Initialize (uses the same Pixel ID)
!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}
(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
fbq('init', 'YOUR_PIXEL_ID');

// Product page viewed
analytics.subscribe("product_viewed", (event) => {
  const v = event.data.productVariant;
  fbq('track', 'ViewContent', {
    content_ids: [v.id],
    content_name: v.product.title,
    content_type: 'product',
    value: v.price.amount,
    currency: v.price.currencyCode
  });
});

// Added to cart
analytics.subscribe("product_added_to_cart", (event) => {
  const v = event.data.cartLine.merchandise;
  fbq('track', 'AddToCart', {
    content_ids: [v.id],
    content_name: v.product.title,
    content_type: 'product',
    value: event.data.cartLine.cost.totalAmount.amount,
    currency: event.data.cartLine.cost.totalAmount.currencyCode
  });
});

// Checkout started
analytics.subscribe("checkout_started", (event) => {
  const c = event.data.checkout;
  fbq('track', 'InitiateCheckout', {
    value: c.totalPrice.amount,
    currency: c.totalPrice.currencyCode,
    num_items: c.lineItems.length
  });
});

// Purchase completed
analytics.subscribe("checkout_completed", (event) => {
  const c = event.data.checkout;
  fbq('track', 'Purchase', {
    content_ids: c.lineItems.map(i => i.variant.id),
    content_type: 'product',
    value: c.totalPrice.amount,
    currency: c.totalPrice.currencyCode,
    num_items: c.lineItems.length
  });
});
```

Replace `YOUR_PIXEL_ID`, then **Save**.

---

## Step 3 — Verify it's working

1. Install the **Meta Pixel Helper** Chrome extension
2. Visit **https://pawlette.shop** in Chrome
3. Click the extension icon — it should show your pixel firing **PageView**
4. Add a product to cart → confirm **AddToCart** fires
5. In **Events Manager → your pixel → Test events**, browse the store and
   watch events arrive in real time

✅ Green checkmarks in Pixel Helper = working.

---

## Step 4 — Connect the pixel to your ad

Once it's firing, your traffic ad (and future sales ads) can use it:
- In Ads Manager, the pixel becomes selectable as a data source
- For future **Sales**-objective campaigns, pick this pixel and optimize for
  **Purchase** — this is where the pixel really pays off
- Build a **retargeting audience**: Events Manager → Audiences → Custom
  Audience → Website → "people who visited in last 30 days" — then show them a
  follow-up ad. Clickers from your $30 traffic test become your warm audience.

---

## Quick reference

| Task | Where |
|------|-------|
| Create pixel / get ID | business.facebook.com/events_manager |
| Easiest install | Shopify → Facebook & Instagram channel (Option A) |
| Manual base code | `theme.liquid`, before `</head>` |
| Manual events | Shopify → Settings → Customer events |
| Verify | Meta Pixel Helper + Events Manager → Test events |
| Retarget clickers | Events Manager → Audiences → Custom Audience |

---

## Notes

- **Don't install both Option A and Option B** — running the pixel twice
  double-counts events. Pick one method.
- The pixel needs your store's **cookie consent banner** to be configured if
  you sell to EU/UK customers (GDPR). Shopify has built-in consent settings
  under **Settings → Customer privacy**.
- For best tracking, enable the **Conversions API** (Option A "Maximum"
  sharing does this automatically) — it sends events server-side, bypassing
  ad blockers and iOS tracking restrictions.
