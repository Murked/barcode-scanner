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
const PUBLISHABLE_PREFIX = 'pk_';

/** True for a Barcodes.gg publishable key (`pk_…`). */
export const isPublishableKey = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().startsWith(PUBLISHABLE_PREFIX);

/** Map a Barcodes.gg API error response to a scanner error code. */
function barcodesError(status: number, message: string): ScannerError | null {
  const cause = message || status;
  if (status === 401) return new ScannerError('unauthorized', cause);
  if (status === 403) {
    if (/allowed domain|Origin or Referer/i.test(message)) return new ScannerError('origin-not-allowed', cause);
    if (/usage|top up/i.test(message)) return new ScannerError('quota-exceeded', cause);
    return new ScannerError('unauthorized', cause);
  }
  if (status === 429) return new ScannerError(/daily/i.test(message) ? 'quota-exceeded' : 'rate-limited', cause);
  if (status === 400) return new ScannerError('invalid-input', cause);
  return null;
}

/**
 * Look products up with the Barcodes.gg API using a publishable key, straight from the
 * browser. Calls `GET /v2/barcode/lookup/{barcode}`, the same endpoint as
 * `sdk.barcodes.lookup()` in `@barcodesgg/sdk`.
 *
 * Create a publishable key at https://barcodes.gg/dashboard/tokens and add your website's
 * domain to its allowed domains. Secret API keys are rejected: never put one in a web page.
 */
export function barcodesLookup(options: BarcodesLookupOptions): LookupFn<Product> {
  const key = options?.publishableKey?.trim();
  if (!key) {
    throw new Error('barcodesLookup: publishableKey is required. Create one at https://barcodes.gg/dashboard/tokens');
  }
  if (!isPublishableKey(key)) {
    throw new Error(
      'barcodesLookup: expected a publishable key starting with "pk_". Never put a secret API key in a web page; ' +
        'create a publishable key at https://barcodes.gg/dashboard/tokens',
    );
  }
  const base = (options.baseUrl ?? BARCODES_API).replace(/\/+$/, '');
  const pageBase = options.pageBaseUrl ?? BARCODES_PAGE;

  return async (value, { signal }) => {
    const url = `${base}/barcode/lookup/${encodeURIComponent(value)}?fields=*`;
    const { res, data } = await getJson(url, { headers: { Authorization: `Bearer ${key}` } }, signal);
    const message = typeof data?.message === 'string' ? data.message : '';

    const error = barcodesError(res.status, message);
    if (error) throw error;
    if (res.status === 404) return { found: false };
    if (!res.ok) throw new ScannerError('lookup-failed', res.status);
    if (data?.error === true) {
      if (NOT_FOUND.test(message)) return { found: false };
      throw new ScannerError('lookup-failed', data.message);
    }
    if (!data?.product) return { found: false };

    const r = data as BarcodesLookupResponse;
    return {
      found: true,
      product: {
        barcode: r.barcode?.barcode_value ?? value,
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
