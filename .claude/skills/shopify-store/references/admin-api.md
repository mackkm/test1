# Shopify Admin API Reference

Quick reference for the GraphQL Admin API mutations used by `shopify-api.js`,
plus the catalog file format.

## Endpoint & auth

```
POST https://{store}.myshopify.com/admin/api/{version}/graphql.json
Headers:
  X-Shopify-Access-Token: shpat_...
  Content-Type: application/json
```

- Use a recent stable API version (e.g. `2024-10`). Bump periodically.
- The admin domain is always `*.myshopify.com`, even with a custom storefront domain.

## Catalog file format (`products.json`)

```json
[
  {
    "title": "Slow-Down Lick Mat",
    "descriptionHtml": "<p>…</p><ul><li>…</li></ul>",
    "productType": "Feeding & Mealtime",
    "vendor": "Pawlettes",
    "tags": ["lick mat", "enrichment"],
    "optionName": "Color",
    "image": "1-lick-mat.png",
    "handle": "slow-down-lick-mat",
    "variants": [
      { "option": "Pink", "sku": "PAWL-001-PINK", "price": "18.00", "weight": 0.19 }
    ]
  }
]
```

- `handle` is optional for create; required for `--update` matching (or `id`).
- `weight` defaults to POUNDS; override per-variant with `"weightUnit"`.
- Variants without `tracked:false` are inventory-tracked by default.

## Core mutations

### Create product
```graphql
mutation($input: ProductInput!) {
  productCreate(input: $input) {
    product { id title handle }
    userErrors { field message }
  }
}
```
`ProductInput` fields used: `title`, `descriptionHtml`, `productType`,
`vendor`, `tags`, `status` (DRAFT|ACTIVE), `options`, `variants`.

### Update product
```graphql
mutation($input: ProductInput!) {
  productUpdate(input: $input) { product { id } userErrors { field message } }
}
```
Requires `input.id` (the product GID). Look it up by handle:
```graphql
query($q: String!) { products(first: 1, query: $q) { edges { node { id handle } } } }
# variables: { "q": "handle:slow-down-lick-mat" }
```

### Attach an image (local file → product)
Three steps: stage → upload bytes → attach.
```graphql
mutation($input: [StagedUploadInput!]!) {
  stagedUploadsCreate(input: $input) {
    stagedTargets { url resourceUrl parameters { name value } }
    userErrors { field message }
  }
}
```
POST the file (multipart form: all `parameters` then `file`) to `url`, then:
```graphql
mutation($id: ID!, $media: [CreateMediaInput!]!) {
  productCreateMedia(productId: $id, media: $media) {
    media { ... on MediaImage { id } }
    mediaUserErrors { field message }
  }
}
# media: [{ alt, mediaContentType: IMAGE, originalSource: <resourceUrl> }]
```

## Collections

```graphql
# Create a manual collection
mutation($input: CollectionInput!) {
  collectionCreate(input: $input) { collection { id } userErrors { field message } }
}
# Add products to it
mutation($id: ID!, $ids: [ID!]!) {
  collectionAddProducts(id: $id, productIds: $ids) {
    collection { id } userErrors { field message }
  }
}
```

## Inventory levels (needs write_inventory scope)

Set available quantity via `inventorySetQuantities` / `inventoryAdjustQuantities`.
Requires the inventory item GID and a location GID (`locations(first:1)`).

## Gotchas

- **Rate limits:** GraphQL uses a cost-based bucket. On HTTP 429, back off and
  retry (the script does exponential backoff up to 5 tries).
- **Variants beyond ~100:** use `productVariantsBulkCreate` for large variant sets.
- **Images need bytes uploaded**, not a local path — always go through staged
  uploads (or pass a public URL as `originalSource`).
- **Drafts vs active:** create as DRAFT, verify, then flip to ACTIVE — avoids
  publishing half-built products to a live store.
- **Money fields are strings** ("18.00"), not numbers.
```
