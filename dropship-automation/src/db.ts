import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface ProductMapping {
  shopifyVariantId: string;
  shopifyProductId: string;
  shopifyInventoryItemId: string;
  supplier: string;
  supplierVariantId: string;
  costPrice: number;
  retailPrice: number;
  updatedAt: string;
}

export interface SupplierOrderRecord {
  shopifyOrderId: string;
  supplier: string;
  supplierOrderId: string;
  status: string;
  trackingNumber?: string;
  trackingUrl?: string;
  createdAt: string;
  updatedAt: string;
}

interface DbShape {
  productMappings: ProductMapping[];
  supplierOrders: SupplierOrderRecord[];
}

const EMPTY_DB: DbShape = { productMappings: [], supplierOrders: [] };

// A small store like this only ever sees one write at a time (a webhook handler
// or a one-shot sync script) so a JSON file is enough and keeps deployment
// dependency-free - no database service to provision for a turnkey setup.
export class JsonStore {
  private filePath: string;
  private cache: DbShape | null = null;

  constructor(dataDir: string, fileName = "store.json") {
    this.filePath = join(dataDir, fileName);
  }

  private async load(): Promise<DbShape> {
    if (this.cache) return this.cache;
    let loaded: DbShape;
    try {
      const raw = await readFile(this.filePath, "utf8");
      loaded = { ...EMPTY_DB, ...JSON.parse(raw) };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        loaded = { ...EMPTY_DB };
      } else {
        throw err;
      }
    }
    this.cache = loaded;
    return loaded;
  }

  private async persist(): Promise<void> {
    if (!this.cache) return;
    await mkdir(dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.tmp`;
    await writeFile(tmpPath, JSON.stringify(this.cache, null, 2));
    await rename(tmpPath, this.filePath);
  }

  async findMappingByShopifyVariantId(shopifyVariantId: string): Promise<ProductMapping | undefined> {
    const db = await this.load();
    return db.productMappings.find((m) => m.shopifyVariantId === shopifyVariantId);
  }

  async findMappingBySupplierVariantId(supplier: string, supplierVariantId: string): Promise<ProductMapping | undefined> {
    const db = await this.load();
    return db.productMappings.find((m) => m.supplier === supplier && m.supplierVariantId === supplierVariantId);
  }

  async upsertProductMapping(mapping: Omit<ProductMapping, "updatedAt">): Promise<void> {
    const db = await this.load();
    const existingIndex = db.productMappings.findIndex((m) => m.shopifyVariantId === mapping.shopifyVariantId);
    const record: ProductMapping = { ...mapping, updatedAt: new Date().toISOString() };
    if (existingIndex >= 0) db.productMappings[existingIndex] = record;
    else db.productMappings.push(record);
    await this.persist();
  }

  async findSupplierOrderByShopifyOrderId(shopifyOrderId: string): Promise<SupplierOrderRecord | undefined> {
    const db = await this.load();
    return db.supplierOrders.find((o) => o.shopifyOrderId === shopifyOrderId);
  }

  async findSupplierOrderBySupplierOrderId(supplier: string, supplierOrderId: string): Promise<SupplierOrderRecord | undefined> {
    const db = await this.load();
    return db.supplierOrders.find((o) => o.supplier === supplier && o.supplierOrderId === supplierOrderId);
  }

  async upsertSupplierOrder(order: Omit<SupplierOrderRecord, "createdAt" | "updatedAt">): Promise<void> {
    const db = await this.load();
    const existingIndex = db.supplierOrders.findIndex(
      (o) => o.shopifyOrderId === order.shopifyOrderId && o.supplier === order.supplier,
    );
    const now = new Date().toISOString();
    if (existingIndex >= 0) {
      db.supplierOrders[existingIndex] = { ...db.supplierOrders[existingIndex], ...order, updatedAt: now };
    } else {
      db.supplierOrders.push({ ...order, createdAt: now, updatedAt: now });
    }
    await this.persist();
  }

  async allProductMappings(): Promise<ProductMapping[]> {
    const db = await this.load();
    return db.productMappings;
  }

  async allOpenSupplierOrders(): Promise<SupplierOrderRecord[]> {
    const db = await this.load();
    return db.supplierOrders.filter((o) => o.status !== "fulfilled" && o.status !== "cancelled");
  }
}
