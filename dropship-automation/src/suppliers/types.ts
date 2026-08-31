export interface SupplierAddress {
  name: string;
  address1: string;
  address2?: string;
  city: string;
  stateCode?: string;
  zip: string;
  countryCode: string;
  phone?: string;
  email?: string;
}

export interface SupplierOrderLineItem {
  supplierVariantId: string;
  quantity: number;
}

export interface SupplierOrderResult {
  supplierOrderId: string;
  status: string;
}

export interface SupplierOrderStatus {
  status: string;
  trackingNumber?: string;
  trackingUrl?: string;
}

export interface SupplierCatalogVariant {
  supplierVariantId: string;
  sku: string;
  title: string;
  costPrice: number;
  inStock: boolean;
}

export interface SupplierCatalogProduct {
  supplierProductId: string;
  title: string;
  variants: SupplierCatalogVariant[];
}

export interface SupplierAdapter {
  readonly name: string;
  fetchCatalog(): Promise<SupplierCatalogProduct[]>;
  createOrder(externalId: string, address: SupplierAddress, items: SupplierOrderLineItem[]): Promise<SupplierOrderResult>;
  getOrderStatus(supplierOrderId: string): Promise<SupplierOrderStatus>;
}
