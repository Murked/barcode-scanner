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

describe('barcodesLookup (Barcodes.gg API)', () => {
  const hit = {
    error: false,
    response_time: '12ms',
    request_fulfilled: true,
    request_debited: true,
    barcode: { barcode_type: 'EAN-13', barcode_value: '196153412345', barcode_added: null, product_size: { us: '9', uk: '8', eu: '42.5' } },
    product: {
      product_name: 'Air Jordan 1 Low',
      product_brand: 'Jordan',
      product_category: 'sneakers',
      product_unique_id: 'prod_123',
      product_description: null,
      product_style_code: 'DZ5485-612',
      product_colorway: 'Red',
      product_release_date: null,
      product_retail_price: 110,
      product_image: 'https://barcodes.gg/api/image/uid/prod_123',
      product_sizes: ['7', '13'],
      product_added: null,
      product_updated: null,
    },
  };

  test('requires a token', () => {
    expect(() => barcodesLookup({ token: '  ' })).toThrow(/token is required/);
  });

  test('calls the v2 barcode lookup endpoint with the bearer token', async () => {
    const fetch = stubFetch(json(hit));
    await barcodesLookup({ token: 'tok_1' })('0196153412345', ctx());
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://barcodes.gg/api/v2/barcode/lookup/0196153412345?fields=*');
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer tok_1');
  });

  test('maps a hit to a Product, keeping the full payload in raw', async () => {
    stubFetch(json(hit));
    const result = await barcodesLookup({ token: 't' })('0196153412345', ctx());
    expect(result).toEqual({
      found: true,
      product: {
        barcode: '196153412345',
        name: 'Air Jordan 1 Low',
        brand: 'Jordan',
        styleCode: 'DZ5485-612',
        imageUrl: 'https://barcodes.gg/api/image/uid/prod_123',
        pageUrl: 'https://barcodes.gg/barcode/0196153412345',
        raw: hit,
      },
    });
  });

  test('custom baseUrl', async () => {
    const fetch = stubFetch(json(hit));
    await barcodesLookup({ token: 't', baseUrl: 'https://staging.barcodes.gg/api/v2/' })('123', ctx());
    expect(fetch.mock.calls[0][0]).toBe('https://staging.barcodes.gg/api/v2/barcode/lookup/123?fields=*');
  });

  test.each(['Barcode could not be found.', 'We do not hold any product information for this barcode.'])(
    '200 { error: true, message: %j } → not found',
    async (message) => {
      stubFetch(json({ error: true, message }));
      expect(await barcodesLookup({ token: 't' })('12345678', ctx())).toEqual({ found: false });
    },
  );

  test.each([
    [401, { error: true, message: 'Invalid authorization token.' }, 'unauthorized'],
    [403, { error: true, message: 'Invalid permissions to perform this action.' }, 'unauthorized'],
    [403, { error: true, message: 'API Token has run out of usage, please top up via the dashboard.' }, 'quota-exceeded'],
    [429, { message: 'Too Many Attempts.' }, 'rate-limited'],
    [400, { error: true, message: 'Please enter a valid barcode.' }, 'invalid-input'],
    [500, { message: 'Server Error' }, 'lookup-failed'],
  ])('%i → %s', async (status, body, code) => {
    stubFetch(json(body, status as number));
    await expect(barcodesLookup({ token: 't' })('12345678', ctx())).rejects.toMatchObject({ code });
  });

  test('an unexpected 200 error envelope → lookup-failed', async () => {
    stubFetch(json({ error: true, message: 'Something else' }));
    await expect(barcodesLookup({ token: 't' })('12345678', ctx())).rejects.toMatchObject({ code: 'lookup-failed' });
  });
});
