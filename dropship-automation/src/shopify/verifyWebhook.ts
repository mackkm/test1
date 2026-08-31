import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyShopifyWebhook(rawBody: Buffer, hmacHeader: string | null | undefined, secret: string): boolean {
  if (!hmacHeader) return false;
  const computed = createHmac("sha256", secret).update(rawBody).digest("base64");
  const expected = Buffer.from(computed);
  const actual = Buffer.from(hmacHeader);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}
