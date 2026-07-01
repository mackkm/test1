# Pawlette Homepage Section — Install (5 minutes)

`pawlette-home.liquid` is a self-contained Shopify theme section: animated hero,
trust bar, featured-product grid with hover effects, scroll-reveal value cards,
rotating testimonials, and a newsletter signup wired to Shopify customers.

## Install

1. Shopify admin → **Online Store → Themes → ⋯ → Edit code**
2. Under **Sections**, click **Add a new section** → name it `pawlette-home`
3. Delete the boilerplate, paste the entire contents of `pawlette-home.liquid`, **Save**
4. Go back → **Customize** (theme editor) → on the Home page, **Add section → Pawlette Home**
5. In the section settings panel:
   - Set the **Featured collection** (e.g. All products or Fan Favorites)
   - Point the two buttons at your catalog / portraits pages
   - Add 2–4 **Testimonial** blocks (real quotes when you have them)
6. Drag the section to the top of the page → **Save**

## Notes

- Works with any Online Store 2.0 theme (Dawn, etc.). Colors are set via CSS
  variables at the top of the `<style>` block (`--pw-accent`, `--pw-accent-2`,
  `--pw-bg`) — tweak to match your brand in one place.
- The newsletter form creates Shopify customers tagged `newsletter`; pair it
  with a `WELCOME10` discount automation (see MULTI-CHANNEL-STRATEGY.md).
- Product cards use each product's featured image — so the mockups/photos you
  attach to products appear here automatically.
