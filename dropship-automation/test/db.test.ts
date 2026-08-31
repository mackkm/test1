import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JsonStore } from "../src/db.js";

describe("JsonStore", () => {
  let dataDir: string;
  let store: JsonStore;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "dropship-test-"));
    store = new JsonStore(dataDir);
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it("returns undefined for a mapping that doesn't exist yet", async () => {
    expect(await store.findMappingByShopifyVariantId("999")).toBeUndefined();
  });

  it("round-trips a product mapping and survives a reload from disk", async () => {
    await store.upsertProductMapping({
      shopifyVariantId: "1",
      shopifyProductId: "10",
      shopifyInventoryItemId: "100",
      supplier: "printful",
      supplierVariantId: "abc",
      costPrice: 10,
      retailPrice: 25,
    });

    const found = await store.findMappingByShopifyVariantId("1");
    expect(found?.supplierVariantId).toBe("abc");

    const reloaded = new JsonStore(dataDir);
    const foundAfterReload = await reloaded.findMappingBySupplierVariantId("printful", "abc");
    expect(foundAfterReload?.shopifyVariantId).toBe("1");
  });

  it("excludes fulfilled and cancelled orders from the open list", async () => {
    await store.upsertSupplierOrder({ shopifyOrderId: "1", supplier: "printful", supplierOrderId: "p1", status: "pending" });
    await store.upsertSupplierOrder({ shopifyOrderId: "2", supplier: "printful", supplierOrderId: "p2", status: "fulfilled" });
    await store.upsertSupplierOrder({ shopifyOrderId: "3", supplier: "printful", supplierOrderId: "p3", status: "cancelled" });

    const open = await store.allOpenSupplierOrders();
    expect(open.map((o) => o.shopifyOrderId)).toEqual(["1"]);
  });
});
