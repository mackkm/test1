# Shopify Product CSV Import Format

For one-time catalog loads with **no API token** — Shopify admin →
**Products → Import**. One row per variant; repeat the Handle to group
variants under one product. Leave product-level fields blank on extra variant
rows (Shopify uses the first row per Handle).

## Required / common columns

| Column | Notes |
|--------|-------|
| `Handle` | URL slug; same value groups variant rows into one product |
| `Title` | Product name (first row per handle) |
| `Body (HTML)` | Description; HTML allowed. Escape `"` as `""` inside quoted fields |
| `Vendor` | Brand |
| `Product Type` | Category |
| `Tags` | Comma-separated inside one quoted field |
| `Published` | TRUE/FALSE |
| `Option1 Name` / `Option1 Value` | e.g. Size / Medium (Option2/3 for more) |
| `Variant SKU` | Unique per variant |
| `Variant Price` | e.g. 18.00 |
| `Variant Requires Shipping` | TRUE for physical, FALSE for made-to-order/personalized |
| `Variant Taxable` | TRUE/FALSE |
| `Variant Weight` / `Variant Weight Unit` | e.g. 0.19 / lb |
| `Variant Image` | Image filename/URL (first variant row); add others in admin |
| `Inventory Qty` | Starting stock |
| `Inventory Tracker` | `shopify` to track |
| `Status` | active / draft |

## Tips

- **Images:** the CSV references image filenames, but the files themselves must
  be uploaded to the product after import (or use public image URLs in the
  `Image Src` column). Easiest: import the CSV, then add media per product.
- **Quoting:** any field containing commas or HTML must be wrapped in double
  quotes; literal double-quotes inside are doubled (`""`).
- **Personalized items:** set `Variant Requires Shipping` appropriately and note
  the personalization instructions in `Body (HTML)`.
- **Validate first:** import into a dev/draft state and review before publishing.

## Minimal example (2 variants, 1 product)

```csv
Handle,Title,Body (HTML),Vendor,Product Type,Tags,Published,Option1 Name,Option1 Value,Variant SKU,Variant Price,Variant Requires Shipping,Variant Taxable,Variant Weight,Variant Weight Unit,Variant Image,Inventory Qty,Inventory Tracker,Status
demo-collar,Demo Collar,"<p>A nice collar.</p>",MyBrand,Accessories,"collar,dog",TRUE,Size,Small,DEMO-S,19.00,TRUE,TRUE,0.1,lb,demo-collar.png,50,shopify,active
demo-collar,Demo Collar,,,,,,Size,Large,DEMO-L,21.00,TRUE,TRUE,0.12,lb,,50,shopify,active
```
