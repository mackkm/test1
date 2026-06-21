import type { JsonStore, SupplierOrderRecord } from "./db.js";
import { logger } from "./logger.js";
import type { ShopifyClient } from "./shopify/client.js";

const SHIPPED_STATUSES = new Set(["shipped", "fulfilled", "delivered"]);

export async function markSupplierOrderShipped(
  shopifyClient: ShopifyClient,
  store: JsonStore,
  record: SupplierOrderRecord,
  status: string,
  trackingNumber: string | undefined,
  trackingUrl: string | undefined,
): Promise<void> {
  if (record.status === "fulfilled") return;
  if (!SHIPPED_STATUSES.has(status) || !trackingNumber) {
    await store.upsertSupplierOrder({ ...record, status });
    return;
  }

  await shopifyClient.createFulfillment(record.shopifyOrderId, {
    tracking_number: trackingNumber,
    tracking_urls: trackingUrl ? [trackingUrl] : undefined,
    notify_customer: true,
  });
  await store.upsertSupplierOrder({ ...record, status: "fulfilled", trackingNumber, trackingUrl });
  logger.info("Marked Shopify order fulfilled with tracking", { shopifyOrderId: record.shopifyOrderId, trackingNumber });
}
