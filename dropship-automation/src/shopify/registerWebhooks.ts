import { loadConfig } from "../config.js";
import { logger } from "../logger.js";
import { ShopifyClient } from "./client.js";

async function main() {
  const config = loadConfig();
  if (!config.publicBaseUrl) {
    throw new Error("Set PUBLIC_BASE_URL in .env to this server's public URL before registering webhooks.");
  }
  const client = new ShopifyClient(config.shopify);
  const address = `${config.publicBaseUrl}/webhooks/shopify/orders-paid`;

  const { webhooks } = await client.listWebhooks();
  const existing = webhooks.find((w) => w.topic === "orders/paid" && w.address === address);
  if (existing) {
    logger.info("Webhook already registered", { id: existing.id, address });
    return;
  }

  const { webhook } = await client.createWebhook("orders/paid", address);
  logger.info("Registered Shopify webhook", { id: webhook.id, address, topic: webhook.topic });
}

main().catch((err) => {
  logger.error("Failed to register webhook", { error: String(err) });
  process.exitCode = 1;
});
