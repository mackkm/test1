import type {
  SupplierAdapter,
  SupplierAddress,
  SupplierCatalogProduct,
  SupplierOrderLineItem,
  SupplierOrderResult,
  SupplierOrderStatus,
} from "./types.js";

// Built against the Printful v1 REST API (https://developers.printful.com/docs/).
// Direct doc fetches were blocked (403) while writing this, and Printful has
// since published a v2 API - verify these field names against current docs
// before going live, and re-check after the first real test order.
export class PrintfulAdapter implements SupplierAdapter {
  readonly name = "printful";
  private baseUrl = "https://api.printful.com";
  private catalogVariantCostCache = new Map<string, number>();

  constructor(private apiKey: string) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        ...(init?.headers as Record<string, string> | undefined),
      },
    });
    const body = (await res.json()) as { result: T };
    if (!res.ok) {
      throw new Error(`Printful API ${res.status} ${path}: ${JSON.stringify(body)}`);
    }
    return body.result;
  }

  private async getCatalogVariantCost(catalogVariantId: number): Promise<number> {
    const key = String(catalogVariantId);
    const cached = this.catalogVariantCostCache.get(key);
    if (cached !== undefined) return cached;
    const result = await this.request<{ variant: { price: string } }>(`/products/variant/${catalogVariantId}`);
    const price = Number(result.variant.price ?? 0);
    this.catalogVariantCostCache.set(key, price);
    return price;
  }

  async fetchCatalog(): Promise<SupplierCatalogProduct[]> {
    const products = await this.request<Array<{ id: number }>>("/store/products");
    const detailed = await Promise.all(
      products.map((p) =>
        this.request<{ sync_product: { id: number; name: string }; sync_variants: any[] }>(`/store/products/${p.id}`),
      ),
    );

    const result: SupplierCatalogProduct[] = [];
    for (const { sync_product, sync_variants } of detailed) {
      const variants = await Promise.all(
        sync_variants.map(async (v) => ({
          supplierVariantId: String(v.id),
          sku: v.sku ?? "",
          title: v.name ?? "",
          costPrice: await this.getCatalogVariantCost(v.variant_id),
          inStock: (v.availability_status ?? "active") !== "discontinued",
        })),
      );
      result.push({ supplierProductId: String(sync_product.id), title: sync_product.name, variants });
    }
    return result;
  }

  async createOrder(externalId: string, address: SupplierAddress, items: SupplierOrderLineItem[]): Promise<SupplierOrderResult> {
    const payload = {
      external_id: externalId,
      recipient: {
        name: address.name,
        address1: address.address1,
        address2: address.address2,
        city: address.city,
        state_code: address.stateCode,
        zip: address.zip,
        country_code: address.countryCode,
        phone: address.phone,
        email: address.email,
      },
      items: items.map((item) => ({ sync_variant_id: Number(item.supplierVariantId), quantity: item.quantity })),
      confirm: true,
    };
    const result = await this.request<{ id: number; status: string }>("/orders", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    return { supplierOrderId: String(result.id), status: result.status };
  }

  async getOrderStatus(supplierOrderId: string): Promise<SupplierOrderStatus> {
    const result = await this.request<{
      status: string;
      shipments?: Array<{ tracking_number: string; tracking_url: string }>;
    }>(`/orders/${supplierOrderId}`);
    const shipment = result.shipments?.[0];
    return { status: result.status, trackingNumber: shipment?.tracking_number, trackingUrl: shipment?.tracking_url };
  }
}
