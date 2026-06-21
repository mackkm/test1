import type { Request, Response, Router } from "express";
import express from "express";
import type { JsonStore } from "../db.js";
import { markSupplierOrderShipped } from "../fulfillment.js";
import { logger } from "../logger.js";
import type { ShopifyClient } from "../shopify/client.js";

export interface PrintfulWebhookDeps {
  webhookToken: string;
  store: JsonStore;
  shopifyClient: ShopifyClient;
}

// Printful's webhook signing scheme wasn't verifiable against live docs at
// the time this was written (see suppliers/printful.ts), so instead of
// guessing at HMAC verification this relies on a shared-secret token in the
// registered URL itself: https://<host>/webhooks/printful/events?token=...
// The periodic sync/syncFulfillments.ts poll job is the dependable path;
// this is a fast-path optimisation on top of it.
export function buildPrintfulWebhookRouter(deps: PrintfulWebhookDeps): Router {
  const router = express.Router();

  router.post("/events", express.json(), async (req: Request, res: Response) => {
    if (!deps.webhookToken || req.query.token !== deps.webhookToken) {
      res.status(401).send("invalid token");
      return;
    }
    res.status(200).send("ok");

    const event = req.body as { type?: string; data?: { order?: { id?: number }; shipment?: { tracking_number?: string; tracking_url?: string } } };
    if (event.type !== "package_shipped" || !event.data?.order?.id) return;

    try {
      const record = await deps.store.findSupplierOrderBySupplierOrderId("printful", String(event.data.order.id));
      if (!record) {
        logger.warn("Printful shipped webhook for unknown order", { printfulOrderId: event.data.order.id });
        return;
      }
      await markSupplierOrderShipped(
        deps.shopifyClient,
        deps.store,
        record,
        "shipped",
        event.data.shipment?.tracking_number,
        event.data.shipment?.tracking_url,
      );
    } catch (err) {
      logger.error("Failed to process Printful webhook", { error: String(err) });
    }
  });

  return router;
}
