export interface ShopifyClientOptions {
  shop: string;
  accessToken: string;
  apiVersion: string;
}

export class ShopifyClient {
  private baseUrl: string;
  private headers: Record<string, string>;

  constructor(options: ShopifyClientOptions) {
    this.baseUrl = `https://${options.shop}/admin/api/${options.apiVersion}`;
    this.headers = {
      "X-Shopify-Access-Token": options.accessToken,
      "Content-Type": "application/json",
    };
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { ...this.headers, ...(init?.headers as Record<string, string> | undefined) },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Shopify API ${res.status} ${path}: ${body}`);
    }
    return res.json() as Promise<T>;
  }

  createProduct(payload: Record<string, unknown>) {
    return this.request<{ product: any }>("/products.json", {
      method: "POST",
      body: JSON.stringify({ product: payload }),
    });
  }

  updateVariant(variantId: string | number, payload: Record<string, unknown>) {
    return this.request<{ variant: any }>(`/variants/${variantId}.json`, {
      method: "PUT",
      body: JSON.stringify({ variant: payload }),
    });
  }

  private primaryLocationId: string | null = null;

  async getPrimaryLocationId(): Promise<string> {
    if (this.primaryLocationId) return this.primaryLocationId;
    const { locations } = await this.request<{ locations: Array<{ id: number }> }>("/locations.json");
    if (!locations.length) throw new Error("Shopify store has no fulfillment locations");
    this.primaryLocationId = String(locations[0].id);
    return this.primaryLocationId;
  }

  async setInventoryLevel(inventoryItemId: string | number, locationId: string | number, available: number): Promise<void> {
    await this.request("/inventory_levels/set.json", {
      method: "POST",
      body: JSON.stringify({ location_id: Number(locationId), inventory_item_id: Number(inventoryItemId), available }),
    });
  }

  createFulfillment(orderId: string | number, payload: Record<string, unknown>) {
    return this.request<{ fulfillment: any }>(`/orders/${orderId}/fulfillments.json`, {
      method: "POST",
      body: JSON.stringify({ fulfillment: payload }),
    });
  }

  listWebhooks() {
    return this.request<{ webhooks: any[] }>("/webhooks.json");
  }

  createWebhook(topic: string, address: string) {
    return this.request<{ webhook: any }>("/webhooks.json", {
      method: "POST",
      body: JSON.stringify({ webhook: { topic, address, format: "json" } }),
    });
  }
}
