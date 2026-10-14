import { ScannerError } from '../errors';
import type { LookupFn, Product } from '../types';
import type { BarcodesLookupOptions, UrlLookupInit } from './types';

export type { UrlLookupInit, BarcodesLookupOptions } from './types';

/**
 * Proxy mode: your backend holds any secret. Every `{barcode}` in `template` is
 * replaced with the URL-encoded value.
 *
 * Response contract: `404` or `{ found: false }` → not found; `429` → `rate-limited`;
 * any other non-2xx → `lookup-failed`; otherwise `{ found: true, product }` or a bare product.
 */
export function urlLookup<P = Product>(template: string, init: UrlLookupInit<P> = {}): LookupFn<P> {
  const { mapProduct, ...requestInit } = init;
  return async (value, { signal }) => {
    const headers = new Headers(requestInit.headers);
    if (!headers.has('Accept')) headers.set('Accept', 'application/json');

    let res: Response;
    try {
      res = await fetch(template.replaceAll('{barcode}', encodeURIComponent(value)), {
        ...requestInit,
        headers,
        signal,
      });
    } catch (e) {
      if (signal.aborted) throw e;
      throw new ScannerError('lookup-failed', e);
    }
    if (res.status === 404) return { found: false };
    if (res.status === 429) throw new ScannerError('rate-limited');
    if (!res.ok) throw new ScannerError('lookup-failed', res.status);

    let data: any;
    try {
      data = await res.json();
    } catch (e) {
      throw new ScannerError('lookup-failed', e);
    }
    if (!data || data.found === false) return { found: false };
    const payload = data.product ?? data;
    return { found: true, product: mapProduct ? mapProduct(payload) : (payload as P) };
  };
}

/** Branded Barcodes API lookup — implemented once publishable keys exist. */
export function barcodesLookup(_opts: BarcodesLookupOptions): LookupFn<Product> {
  throw new Error('barcodesLookup is not available yet');
}
