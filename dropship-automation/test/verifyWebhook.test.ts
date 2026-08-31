import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyShopifyWebhook } from "../src/shopify/verifyWebhook.js";

describe("verifyShopifyWebhook", () => {
  const secret = "test-secret";
  const body = Buffer.from(JSON.stringify({ id: 123 }));

  it("accepts a correctly signed payload", () => {
    const hmac = createHmac("sha256", secret).update(body).digest("base64");
    expect(verifyShopifyWebhook(body, hmac, secret)).toBe(true);
  });

  it("rejects a payload signed with the wrong secret", () => {
    const hmac = createHmac("sha256", "wrong-secret").update(body).digest("base64");
    expect(verifyShopifyWebhook(body, hmac, secret)).toBe(false);
  });

  it("rejects a tampered body", () => {
    const hmac = createHmac("sha256", secret).update(body).digest("base64");
    const tampered = Buffer.from(JSON.stringify({ id: 456 }));
    expect(verifyShopifyWebhook(tampered, hmac, secret)).toBe(false);
  });

  it("rejects a missing header", () => {
    expect(verifyShopifyWebhook(body, undefined, secret)).toBe(false);
  });
});
