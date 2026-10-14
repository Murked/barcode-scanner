export type { Product, LookupResult, LookupFn } from '../types';

export interface UrlLookupInit<P> extends RequestInit {
  /**
   * Map the JSON payload (`data.product ?? data`) to your product shape. Use it to
   * adapt an existing endpoint, e.g. `{ image_url }` → `{ imageUrl }`.
   */
  mapProduct?: (data: any) => P;
}

export interface BarcodesLookupOptions {
  /**
   * Barcodes.gg publishable key (`pk_…`) from https://barcodes.gg/dashboard/tokens.
   * Safe to use in web pages: it can only look up barcodes, from the domains you allow.
   */
  publishableKey: string;
  /** API base URL. Default `https://barcodes.gg/api/v2`. */
  baseUrl?: string;
  /** Public product page base used for `pageUrl`. Default `https://barcodes.gg/barcode/`. */
  pageBaseUrl?: string;
}

/** `GET /v2/barcode/lookup/{barcode}?fields=*` success payload (same as `@barcodesgg/sdk`). */
export interface BarcodesLookupResponse {
  error: false;
  barcode: {
    barcode_type: string;
    barcode_value: string;
    barcode_added: string | null;
    product_size: { us: string | number | null; uk: string | number | null; eu: string | number | null };
  };
  product: {
    product_name: string | null;
    product_brand: string | null;
    product_category: string | null;
    product_unique_id: string | null;
    product_description: string | null;
    product_style_code: string | null;
    product_colorway: string | null;
    product_release_date: string | null;
    product_retail_price: string | number | null;
    product_image: string | null;
    product_sizes: string[];
    product_added: string | null;
    product_updated: string | null;
  };
  [key: string]: unknown;
}
