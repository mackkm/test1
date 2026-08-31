export interface ShopifyLineItem {
  id: number;
  variant_id: number | null;
  product_id: number | null;
  sku: string;
  quantity: number;
  title: string;
}

export interface ShopifyAddress {
  first_name?: string;
  last_name?: string;
  name?: string;
  address1: string;
  address2?: string;
  city: string;
  province_code?: string;
  zip: string;
  country_code: string;
  phone?: string;
}

export interface ShopifyOrder {
  id: number;
  name: string;
  email?: string;
  financial_status: string;
  line_items: ShopifyLineItem[];
  shipping_address?: ShopifyAddress;
  customer?: { first_name?: string; last_name?: string; email?: string };
}
