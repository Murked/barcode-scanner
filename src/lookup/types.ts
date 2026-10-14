export type { Product, LookupResult, LookupFn } from '../types';

export interface UrlLookupInit<P> extends RequestInit {
  /**
   * Map the JSON payload (`data.product ?? data`) to your product shape. Use it to
   * adapt an existing endpoint, e.g. `{ image_url }` → `{ imageUrl }`.
   */
  mapProduct?: (data: any) => P;
}

export interface BarcodesLookupOptions {
  key: string;
  baseUrl?: string;
}
