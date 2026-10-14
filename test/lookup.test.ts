import { afterEach, describe, expect, test, vi } from 'vitest';
import { barcodesLookup, urlLookup } from '../src';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function stubFetch(res: Response | (() => Promise<Response>)) {
  const fetch = vi.fn(async (..._args: unknown[]) => (typeof res === 'function' ? res() : res.clone()));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

const ctx = () => ({ signal: new AbortController().signal });

afterEach(() => vi.unstubAllGlobals());

describe('urlLookup', () => {
  test('replaces {barcode} (encoded) and sends Accept: application/json', async () => {
    const fetch = stubFetch(json({ found: true, product: { barcode: '1', name: 'A' } }));
    const signal = new AbortController().signal;
    await urlLookup('/api/lookup/{barcode}?q={barcode}')('12 3/4', { signal });
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/lookup/12%203%2F4?q=12%203%2F4');
    expect(new Headers(init.headers).get('Accept')).toBe('application/json');
    expect(init.signal).toBe(signal);
  });

  test('keeps custom request init and headers', async () => {
    const fetch = stubFetch(json({ found: false }));
    await urlLookup('/x/{barcode}', { credentials: 'include', headers: { 'X-Key': 'k', Accept: 'text/plain' } })('1', ctx());
    const init = fetch.mock.calls[0][1] as RequestInit;
    expect(init.credentials).toBe('include');
    expect(new Headers(init.headers).get('X-Key')).toBe('k');
    expect(new Headers(init.headers).get('Accept')).toBe('text/plain');
  });

  test('{ found: true, product } → found', async () => {
    stubFetch(json({ found: true, product: { barcode: '1', name: 'A' } }));
    expect(await urlLookup('/{barcode}')('1', ctx())).toEqual({ found: true, product: { barcode: '1', name: 'A' } });
  });

  test('a bare product payload → found', async () => {
    stubFetch(json({ barcode: '1', name: 'A' }));
    expect(await urlLookup('/{barcode}')('1', ctx())).toEqual({ found: true, product: { barcode: '1', name: 'A' } });
  });

  test('{ found: false } and 404 → not found', async () => {
    stubFetch(json({ found: false }));
    expect(await urlLookup('/{barcode}')('1', ctx())).toEqual({ found: false });
    stubFetch(json({ message: 'nope' }, 404));
    expect(await urlLookup('/{barcode}')('1', ctx())).toEqual({ found: false });
  });

  test('429 → rate-limited, other errors → lookup-failed', async () => {
    stubFetch(json({}, 429));
    await expect(urlLookup('/{barcode}')('1', ctx())).rejects.toMatchObject({ code: 'rate-limited' });
    stubFetch(json({}, 500));
    await expect(urlLookup('/{barcode}')('1', ctx())).rejects.toMatchObject({ code: 'lookup-failed' });
    stubFetch(new Response('<html>', { status: 200 }));
    await expect(urlLookup('/{barcode}')('1', ctx())).rejects.toMatchObject({ code: 'lookup-failed' });
    stubFetch(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(urlLookup('/{barcode}')('1', ctx())).rejects.toMatchObject({ code: 'lookup-failed' });
  });

  test('mapProduct adapts a flat payload', async () => {
    stubFetch(json({ found: true, name: 'Air', brand: 'Nike', style_code: 'DD1', image_url: '/i.jpg', page_url: '/p' }));
    const lookup = urlLookup('/{barcode}', {
      mapProduct: (d) => ({ barcode: '1', name: d.name, brand: d.brand, styleCode: d.style_code, imageUrl: d.image_url, pageUrl: d.page_url, raw: d }),
    });
    const result = await lookup('1', ctx());
    expect(result).toMatchObject({ found: true, product: { name: 'Air', styleCode: 'DD1', imageUrl: '/i.jpg', pageUrl: '/p' } });
  });

  test('rethrows aborts untouched', async () => {
    const ctrl = new AbortController();
    stubFetch(async () => {
      ctrl.abort();
      throw new DOMException('aborted', 'AbortError');
    });
    await expect(urlLookup('/{barcode}')('1', { signal: ctrl.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });
});

test('barcodesLookup is a stub until publishable keys exist', () => {
  expect(() => barcodesLookup({ key: 'pk_x' })).toThrow(/not available yet/);
});
