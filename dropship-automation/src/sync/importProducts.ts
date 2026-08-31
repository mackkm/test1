import { JsonStore, type ProductMapping } from "../db.js";
import { loadConfig } from "../config.js";
import { logger } from "../logger.js";
import { computeRetailPrice } from "../pricing.js";
import { ShopifyClient } from "../shopify/client.js";
import { buildSupplierRegistry } from "../suppliers/registry.js";
import type { SupplierCatalogProduct } from "../suppliers/types.js";

const IN_STOCK_QUANTITY = 999;

async function main() {
  const config = loadConfig();
  const shopify = new ShopifyClient(config.shopify);
  const store = new JsonStore(config.dataDir);
  const suppliers = buildSupplierRegistry(config);
  const locationId = await shopify.getPrimaryLocationId();

  for (const adapter of suppliers.values()) {
    logger.info("Fetching catalog", { supplier: adapter.name });
    const catalog = await adapter.fetchCatalog();

    for (const product of catalog) {
      const existingMappings = await Promise.all(
        product.variants.map((v) => store.findMappingBySupplierVariantId(adapter.name, v.supplierVariantId)),
      );

      if (existingMappings.some(Boolean)) {
        await updateExistingVariants(shopify, store, locationId, config.markupMultiplier, product, existingMappings);
        continue;
      }

      await createNewProduct(shopify, store, locationId, config.markupMultiplier, adapter.name, product);
    }
  }

  logger.info("Product import complete");
}

async function updateExistingVariants(
  shopify: ShopifyClient,
  store: JsonStore,
  locationId: string,
  markupMultiplier: number,
  product: SupplierCatalogProduct,
  existingMappings: Array<ProductMapping | undefined>,
) {
  for (let i = 0; i < product.variants.length; i++) {
    const variant = product.variants[i];
    const mapping = existingMappings[i];
    if (!mapping) {
      logger.warn("Product already imported but this variant is new - adding new variants to an existing product isn't automated yet", {
        product: product.title,
        supplierVariantId: variant.supplierVariantId,
      });
      continue;
    }
    const retailPrice = computeRetailPrice(variant.costPrice, markupMultiplier);
    await shopify.updateVariant(mapping.shopifyVariantId, { price: retailPrice.toFixed(2) });
    await shopify.setInventoryLevel(mapping.shopifyInventoryItemId, locationId, variant.inStock ? IN_STOCK_QUANTITY : 0);
    await store.upsertProductMapping({ ...mapping, costPrice: variant.costPrice, retailPrice });
  }
}

async function createNewProduct(
  shopify: ShopifyClient,
  store: JsonStore,
  locationId: string,
  markupMultiplier: number,
  supplierName: string,
  product: SupplierCatalogProduct,
) {
  const variantsPayload = product.variants.map((v) => ({
    sku: v.sku,
    price: computeRetailPrice(v.costPrice, markupMultiplier).toFixed(2),
    option1: v.title || "Default",
    inventory_management: "shopify",
    inventory_policy: "deny",
    inventory_quantity: v.inStock ? IN_STOCK_QUANTITY : 0,
  }));

  const { product: created } = await shopify.createProduct({
    title: product.title,
    vendor: supplierName,
    status: "active",
    variants: variantsPayload,
  });

  for (let i = 0; i < product.variants.length; i++) {
    const variant = product.variants[i];
    const createdVariant = created.variants[i];
    const retailPrice = computeRetailPrice(variant.costPrice, markupMultiplier);
    await store.upsertProductMapping({
      shopifyVariantId: String(createdVariant.id),
      shopifyProductId: String(created.id),
      shopifyInventoryItemId: String(createdVariant.inventory_item_id),
      supplier: supplierName,
      supplierVariantId: variant.supplierVariantId,
      costPrice: variant.costPrice,
      retailPrice,
    });
    // Inventory level at creation time is set via inventory_quantity above; this
    // call just ensures it matches in case Shopify ignored it for this location.
    await shopify.setInventoryLevel(createdVariant.inventory_item_id, locationId, variant.inStock ? IN_STOCK_QUANTITY : 0);
  }

  logger.info("Imported new product", { title: product.title, shopifyProductId: created.id, variants: created.variants.length });
}

main().catch((err) => {
  logger.error("Product import failed", { error: String(err) });
  process.exitCode = 1;
});
