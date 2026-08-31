import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}. Copy .env.example to .env and fill it in.`);
  }
  return value;
}

export interface Config {
  port: number;
  shopify: {
    shop: string;
    accessToken: string;
    apiSecret: string;
    apiVersion: string;
  };
  printful: {
    apiKey: string;
    webhookSecret: string;
  };
  markupMultiplier: number;
  publicBaseUrl: string;
  dataDir: string;
  inventorySyncIntervalMinutes: number;
}

// Loaded lazily (not at import time) so pure-logic modules can be unit tested
// without every required env var being set.
export function loadConfig(): Config {
  return {
    port: Number(process.env.PORT ?? 3000),
    shopify: {
      shop: required("SHOPIFY_SHOP"),
      accessToken: required("SHOPIFY_ADMIN_API_ACCESS_TOKEN"),
      apiSecret: required("SHOPIFY_API_SECRET"),
      apiVersion: process.env.SHOPIFY_API_VERSION ?? "2024-10",
    },
    printful: {
      apiKey: required("PRINTFUL_API_KEY"),
      webhookSecret: process.env.PRINTFUL_WEBHOOK_SECRET ?? "",
    },
    markupMultiplier: Number(process.env.MARKUP_MULTIPLIER ?? 2.5),
    publicBaseUrl: process.env.PUBLIC_BASE_URL ?? "",
    dataDir: process.env.DATA_DIR ?? "./data",
    inventorySyncIntervalMinutes: Number(process.env.INVENTORY_SYNC_INTERVAL_MINUTES ?? 60),
  };
}
