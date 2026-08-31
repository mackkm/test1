import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JsonStore } from "../src/db.js";
import { routeOrder } from "../src/routes/shopifyWebhooks.js";
import type { ShopifyOrder } from "../src/shopify/types.js";
import type { SupplierAdapter } from "../src/suppliers/types.js";

function fakeOrder(overrides: Partial<ShopifyOrder> = {}): ShopifyOrder {
  return {
    id: 1001,
    name: "#1001",
    email: "buyer@example.com",
    financial_status: "paid",
    line_items: [{ id: 1, variant_id: 111, product_id: 11, sku: "SKU-1", quantity: 2, title: "Pawlette Bandana" }],
    shipping_address: {
      first_name: "Jane",
      last_name: "Doe",
      address1: "1 Main St",
      city: "Springfield",
      province_code: "IL",
      zip: "62704",
      country_code: "US",
    },
    ...overrides,
  };
}

function fakeAdapter(): SupplierAdapter & { createOrder: ReturnType<typeof vi.fn> } {
  return {
    name: "printful",
    fetchCatalog: vi.fn(),
    createOrder: vi.fn().mockResolvedValue({ supplierOrderId: "supplier-order-1", status: "pending" }),
    getOrderStatus: vi.fn(),
  };
}

describe("routeOrder", () => {
  let dataDir: string;
  let store: JsonStore;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "dropship-route-test-"));
    store = new JsonStore(dataDir);
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it("places a supplier order for a mapped line item and records it", async () => {
    await store.upsertProductMapping({
      shopifyVariantId: "111",
      shopifyProductId: "11",
      shopifyInventoryItemId: "1100",
      supplier: "printful",
      supplierVariantId: "pf-var-1",
      costPrice: 10,
      retailPrice: 25,
    });
    const adapter = fakeAdapter();
    const suppliers = new Map([["printful", adapter]]);

    await routeOrder(fakeOrder(), { webhookSecret: "x", store, suppliers });

    expect(adapter.createOrder).toHaveBeenCalledTimes(1);
    const [externalId, address, items] = adapter.createOrder.mock.calls[0];
    expect(externalId).toBe("#1001");
    expect(address).toMatchObject({ name: "Jane Doe", city: "Springfield", countryCode: "US" });
    expect(items).toEqual([{ supplierVariantId: "pf-var-1", quantity: 2 }]);

    const recorded = await store.findSupplierOrderByShopifyOrderId("1001");
    expect(recorded?.supplierOrderId).toBe("supplier-order-1");
  });

  it("skips line items with no supplier mapping instead of failing the whole order", async () => {
    const adapter = fakeAdapter();
    const suppliers = new Map([["printful", adapter]]);

    await routeOrder(fakeOrder(), { webhookSecret: "x", store, suppliers });

    expect(adapter.createOrder).not.toHaveBeenCalled();
  });

  it("skips orders with no shipping address", async () => {
    const adapter = fakeAdapter();
    const suppliers = new Map([["printful", adapter]]);

    await routeOrder(fakeOrder({ shipping_address: undefined }), { webhookSecret: "x", store, suppliers });

    expect(adapter.createOrder).not.toHaveBeenCalled();
  });

  it("does not place a duplicate supplier order if one was already recorded (webhook retry safety)", async () => {
    await store.upsertProductMapping({
      shopifyVariantId: "111",
      shopifyProductId: "11",
      shopifyInventoryItemId: "1100",
      supplier: "printful",
      supplierVariantId: "pf-var-1",
      costPrice: 10,
      retailPrice: 25,
    });
    await store.upsertSupplierOrder({
      shopifyOrderId: "1001",
      supplier: "printful",
      supplierOrderId: "already-placed",
      status: "pending",
    });
    const adapter = fakeAdapter();
    const suppliers = new Map([["printful", adapter]]);

    await routeOrder(fakeOrder(), { webhookSecret: "x", store, suppliers });

    expect(adapter.createOrder).not.toHaveBeenCalled();
  });
});
