import type { Request, Response, Router } from "express";
import express from "express";
import type { JsonStore } from "../db.js";
import { logger } from "../logger.js";
import type { ShopifyAddress, ShopifyOrder } from "../shopify/types.js";
import { verifyShopifyWebhook } from "../shopify/verifyWebhook.js";
import type { SupplierAdapter, SupplierAddress, SupplierOrderLineItem } from "../suppliers/types.js";

function toSupplierAddress(order: ShopifyOrder, address: ShopifyAddress): SupplierAddress {
  const fullName = [address.first_name, address.last_name].filter(Boolean).join(" ");
  const name = address.name ?? (fullName || "Customer");
  return {
    name,
    address1: address.address1,
    address2: address.address2,
    city: address.city,
    stateCode: address.province_code,
    zip: address.zip,
    countryCode: address.country_code,
    phone: address.phone,
    email: order.email ?? order.customer?.email,
  };
}

export interface ShopifyWebhookDeps {
  webhookSecret: string;
  store: JsonStore;
  suppliers: Map<string, SupplierAdapter>;
}

// Routes a paid Shopify order to the right supplier(s) based on previously
// imported product mappings. A single order can span multiple suppliers, so
// line items are grouped and one supplier order is placed per group.
export function buildShopifyWebhookRouter(deps: ShopifyWebhookDeps): Router {
  const router = express.Router();

  router.post(
    "/orders-paid",
    express.raw({ type: "application/json" }),
    async (req: Request, res: Response) => {
      const hmacHeader = req.header("X-Shopify-Hmac-Sha256");
      const rawBody = req.body as Buffer;

      if (!verifyShopifyWebhook(rawBody, hmacHeader, deps.webhookSecret)) {
        logger.warn("Rejected Shopify webhook with invalid HMAC");
        res.status(401).send("invalid signature");
        return;
      }

      // Acknowledge immediately - Shopify expects a fast response and will
      // retry on timeout, which would otherwise risk duplicate supplier orders.
      res.status(200).send("ok");

      const order: ShopifyOrder = JSON.parse(rawBody.toString("utf8"));
      try {
        await routeOrder(order, deps);
      } catch (err) {
        logger.error("Failed to route order to supplier", { orderId: order.id, error: String(err) });
      }
    },
  );

  return router;
}

export async function routeOrder(order: ShopifyOrder, deps: ShopifyWebhookDeps): Promise<void> {
  const shopifyOrderId = String(order.id);
  if (!order.shipping_address) {
    logger.warn("Order has no shipping address, skipping", { orderId: shopifyOrderId });
    return;
  }

  const itemsBySupplier = new Map<string, SupplierOrderLineItem[]>();
  for (const lineItem of order.line_items) {
    if (lineItem.variant_id === null) continue;
    const mapping = await deps.store.findMappingByShopifyVariantId(String(lineItem.variant_id));
    if (!mapping) {
      logger.warn("No supplier mapping for line item, skipping", {
        orderId: shopifyOrderId,
        variantId: lineItem.variant_id,
      });
      continue;
    }
    const items = itemsBySupplier.get(mapping.supplier) ?? [];
    items.push({ supplierVariantId: mapping.supplierVariantId, quantity: lineItem.quantity });
    itemsBySupplier.set(mapping.supplier, items);
  }

  for (const [supplierName, items] of itemsBySupplier) {
    const adapter = deps.suppliers.get(supplierName);
    if (!adapter) {
      logger.error("Unknown supplier in mapping, cannot fulfil", { supplierName, orderId: shopifyOrderId });
      continue;
    }

    const existing = await deps.store.findSupplierOrderByShopifyOrderId(shopifyOrderId);
    if (existing && existing.supplier === supplierName) {
      logger.info("Supplier order already placed for this Shopify order, skipping", { orderId: shopifyOrderId });
      continue;
    }

    const address = toSupplierAddress(order, order.shipping_address);
    const result = await adapter.createOrder(order.name, address, items);
    await deps.store.upsertSupplierOrder({
      shopifyOrderId,
      supplier: supplierName,
      supplierOrderId: result.supplierOrderId,
      status: result.status,
    });
    logger.info("Placed supplier order", { orderId: shopifyOrderId, supplier: supplierName, supplierOrderId: result.supplierOrderId });
  }
}
