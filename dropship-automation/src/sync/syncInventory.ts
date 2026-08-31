import { JsonStore } from "../db.js";
import { loadConfig } from "../config.js";
import { logger } from "../logger.js";
import { computeRetailPrice } from "../pricing.js";
import { ShopifyClient } from "../shopify/client.js";
import { buildSupplierRegistry } from "../suppliers/registry.js";
import type { SupplierAdapter } from "../suppliers/types.js";

const IN_STOCK_QUANTITY = 999;

export async function syncInventory(shopify: ShopifyClient, store: JsonStore, suppliers: Map<string, SupplierAdapter>, markupMultiplier: number) {
  const locationId = await shopify.getPrimaryLocationId();

  for (const adapter of suppliers.values()) {
    const catalog = await adapter.fetchCatalog();
    for (const product of catalog) {
      for (const variant of product.variants) {
        const mapping = await store.findMappingBySupplierVariantId(adapter.name, variant.supplierVariantId);
        if (!mapping) continue;

        const retailPrice = computeRetailPrice(variant.costPrice, markupMultiplier);
        if (retailPrice !== mapping.retailPrice) {
          await shopify.updateVariant(mapping.shopifyVariantId, { price: retailPrice.toFixed(2) });
        }
        await shopify.setInventoryLevel(mapping.shopifyInventoryItemId, locationId, variant.inStock ? IN_STOCK_QUANTITY : 0);
        await store.upsertProductMapping({ ...mapping, costPrice: variant.costPrice, retailPrice });
      }
    }
  }
  logger.info("Inventory sync complete");
}

async function main() {
  const config = loadConfig();
  const shopify = new ShopifyClient(config.shopify);
  const store = new JsonStore(config.dataDir);
  const suppliers = buildSupplierRegistry(config);
  await syncInventory(shopify, store, suppliers, config.markupMultiplier);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    logger.error("Inventory sync failed", { error: String(err) });
    process.exitCode = 1;
  });
}
