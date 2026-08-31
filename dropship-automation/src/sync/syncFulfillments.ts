import type { JsonStore } from "../db.js";
import { markSupplierOrderShipped } from "../fulfillment.js";
import { logger } from "../logger.js";
import type { ShopifyClient } from "../shopify/client.js";
import type { SupplierAdapter } from "../suppliers/types.js";

// Reconciliation safety net: re-checks every open supplier order's status in
// case a Printful webhook was missed. Safe to call on an interval.
export async function syncFulfillments(shopifyClient: ShopifyClient, store: JsonStore, suppliers: Map<string, SupplierAdapter>) {
  const openOrders = await store.allOpenSupplierOrders();
  for (const record of openOrders) {
    const adapter = suppliers.get(record.supplier);
    if (!adapter) continue;
    try {
      const { status, trackingNumber, trackingUrl } = await adapter.getOrderStatus(record.supplierOrderId);
      await markSupplierOrderShipped(shopifyClient, store, record, status, trackingNumber, trackingUrl);
    } catch (err) {
      logger.error("Failed to sync fulfillment status", { shopifyOrderId: record.shopifyOrderId, error: String(err) });
    }
  }
}
