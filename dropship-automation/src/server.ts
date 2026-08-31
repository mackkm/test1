import express from "express";
import { loadConfig } from "./config.js";
import { JsonStore } from "./db.js";
import { logger } from "./logger.js";
import { buildShopifyWebhookRouter } from "./routes/shopifyWebhooks.js";
import { buildPrintfulWebhookRouter } from "./routes/printfulWebhooks.js";
import { ShopifyClient } from "./shopify/client.js";
import { buildSupplierRegistry } from "./suppliers/registry.js";
import { syncFulfillments } from "./sync/syncFulfillments.js";
import { syncInventory } from "./sync/syncInventory.js";

const config = loadConfig();
const shopifyClient = new ShopifyClient(config.shopify);
const store = new JsonStore(config.dataDir);
const suppliers = buildSupplierRegistry(config);

const app = express();

app.get("/healthz", (_req, res) => res.status(200).send("ok"));

app.use(
  "/webhooks/shopify",
  buildShopifyWebhookRouter({ webhookSecret: config.shopify.apiSecret, store, suppliers }),
);
app.use(
  "/webhooks/printful",
  buildPrintfulWebhookRouter({ webhookToken: config.printful.webhookSecret, store, shopifyClient }),
);

app.listen(config.port, () => {
  logger.info("Server listening", { port: config.port });
});

const fulfillmentIntervalMs = 5 * 60 * 1000;
setInterval(() => {
  syncFulfillments(shopifyClient, store, suppliers).catch((err) =>
    logger.error("Scheduled fulfillment sync failed", { error: String(err) }),
  );
}, fulfillmentIntervalMs);

const inventoryIntervalMs = config.inventorySyncIntervalMinutes * 60 * 1000;
setInterval(() => {
  syncInventory(shopifyClient, store, suppliers, config.markupMultiplier).catch((err) =>
    logger.error("Scheduled inventory sync failed", { error: String(err) }),
  );
}, inventoryIntervalMs);
