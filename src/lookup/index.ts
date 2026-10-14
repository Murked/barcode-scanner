import { ScannerError } from '../errors';
import type { LookupFn, Product } from '../types';
import type { BarcodesLookupOptions, BarcodesLookupResponse, UrlLookupInit } from './types';

export type { UrlLookupInit, BarcodesLookupOptions, BarcodesLookupResponse } from './types';

const BARCODES_API = 'https://barcodes.gg/api/v2';
const BARCODES_PAGE = 'https://barcodes.gg/barcode/';

async function getJson(url: string, init: RequestInit, signal: AbortSignal) {
  const headers = new Headers(init.headers);
  if (!headers.has('Accept')) headers.set('Accept', 'application/json');
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers, signal });
  } catch (e) {
    if (signal.aborted) throw e;
    throw new ScannerError('lookup-failed', e);
  }
  let data: any = null;
  try {
    data = await res.json();
  } catch (e) {
    if (res.ok) throw new ScannerError('lookup-failed', e);
  }
  return { res, data };
}

/**
 * Look products up through your own backend. Every `{barcode}` in `template` is replaced
 * with the URL-encoded value.
 *
 * Response contract: `404` or `{ found: false }` → not found; `429` → `rate-limited`;
 * any other non-2xx → `lookup-failed`; otherwise `{ found: true, product }` or a bare product.
 */
export function urlLookup<P = Product>(template: string, init: UrlLookupInit<P> = {}): LookupFn<P> {
  const { mapProduct, ...requestInit } = init;
  return async (value, { signal }) => {
    const url = template.replaceAll('{barcode}', encodeURIComponent(value));
    const { res, data } = await getJson(url, requestInit, signal);
    if (res.status === 404) return { found: false };
    if (res.status === 429) throw new ScannerError('rate-limited');
    if (!res.ok) throw new ScannerError('lookup-failed', res.status);
    if (!data || data.found === false) return { found: false };
    const payload = data.product ?? data;
    return { found: true, product: mapProduct ? mapProduct(payload) : (payload as P) };
  };
}

const NOT_FOUND = /could not be found|do not hold any product/i;

/**
 * Look products up with the Barcodes.gg API (`GET /v2/barcode/lookup/{barcode}`, the same
 * endpoint as `sdk.barcodes.lookup()` in `@barcodesgg/sdk`), straight from the browser.
 *
 * The token is visible to anyone using your page: use a token that only has the
 * "lookup barcode" permission, or keep it on a server and use `urlLookup` instead.
 */
export function barcodesLookup(options: BarcodesLookupOptions): LookupFn<Product> {
  const token = options.token?.trim();
  if (!token) throw new Error('barcodesLookup: token is required');
  const base = (options.baseUrl ?? BARCODES_API).replace(/\/+$/, '');
  const pageBase = options.pageBaseUrl ?? BARCODES_PAGE;

  return async (value, { signal }) => {
    const url = `${base}/barcode/lookup/${encodeURIComponent(value)}?fields=*`;
    const { res, data } = await getJson(url, { headers: { Authorization: `Bearer ${token}` } }, signal);
    const message = typeof data?.message === 'string' ? data.message : '';

    if (res.status === 401) throw new ScannerError('unauthorized', message || res.status);
    if (res.status === 403) {
      throw new ScannerError(/usage|top up/i.test(message) ? 'quota-exceeded' : 'unauthorized', message || res.status);
    }
    if (res.status === 429) throw new ScannerError('rate-limited');
    if (res.status === 400) throw new ScannerError('invalid-input', data?.message ?? res.status);
    if (res.status === 404) return { found: false };
    if (!res.ok) throw new ScannerError('lookup-failed', res.status);
    if (data?.error === true) {
      if (NOT_FOUND.test(message)) return { found: false };
      throw new ScannerError('lookup-failed', data.message);
    }
    if (!data?.product) return { found: false };

    const r = data as BarcodesLookupResponse;
    const barcode = r.barcode?.barcode_value ?? value;
    return {
      found: true,
      product: {
        barcode,
        name: r.product.product_name ?? '',
        brand: r.product.product_brand,
        styleCode: r.product.product_style_code ?? undefined,
        imageUrl: r.product.product_image ?? undefined,
        pageUrl: pageBase + encodeURIComponent(value),
        raw: r,
      },
    };
  };
}
