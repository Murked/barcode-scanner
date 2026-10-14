import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { BarcodeScannerElement } from '../src/element';
import { EAN, setHidden, setSecureContext, stubGetUserMedia, stubVideoElement } from './helpers';

let reads: (string | null)[] = [];
let rest: string | null = null;
let detectorCtor: ReturnType<typeof vi.fn<(opts: unknown) => void>>;

function installNativeDetector() {
  detectorCtor = vi.fn<(opts: unknown) => void>();
  vi.stubGlobal(
    'BarcodeDetector',
    class {
      static getSupportedFormats = async () => ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code', 'itf'];
      constructor(opts: unknown) {
        detectorCtor(opts);
      }
      async detect() {
        const next = reads.length ? reads.shift()! : rest;
        return next ? [{ rawValue: next, format: 'ean_13' }] : [];
      }
    },
  );
}

function stubFetch(body: unknown, status = 200) {
  const fetch = vi.fn(async (..._args: unknown[]) => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

function mount(html: string) {
  document.body.innerHTML = html;
  return document.body.firstElementChild as BarcodeScannerElement;
}

const shadow = (el: Element) => el.shadowRoot!;
const q = <T extends Element = HTMLElement>(el: Element, sel: string) => shadow(el).querySelector<T>(sel)!;
const statusText = (el: Element) => q(el, '[data-status-text]').textContent;

function collect(_el: Element, name: string) {
  const events: CustomEvent[] = [];
  document.addEventListener(name, (e) => events.push(e as CustomEvent));
  return events;
}

beforeEach(() => {
  vi.useFakeTimers();
  setSecureContext(true);
  setHidden(false);
  stubVideoElement();
  installNativeDetector();
  reads = [];
  rest = null;
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('<barcode-scanner>', () => {
  test('is registered and renders the default UI', () => {
    const el = mount('<barcode-scanner></barcode-scanner>');
    expect(el).toBeInstanceOf(BarcodeScannerElement);
    expect(customElements.get('barcode-scanner')).toBe(BarcodeScannerElement);
    expect(q(el, '[data-start]').textContent).toBe('Start camera');
    expect(q(el, '[data-start]').hidden).toBe(false);
    expect(q(el, '[data-stop]').hidden).toBe(true);
    expect(q(el, '[data-manual]').hidden).toBe(true);
    expect(q(el, '[data-result]').hidden).toBe(true);
    expect(statusText(el)).toBe('Camera off.');
    expect(el.getAttribute('state')).toBe('idle');
    expect(el.scanner?.state).toBe('idle');
    for (const part of ['root', 'viewfinder', 'video', 'reticle', 'controls', 'status', 'manual', 'result']) {
      expect(shadow(el).querySelector(`[part~="${part}"]`), part).not.toBeNull();
    }
  });

  test('manual-entry attribute toggles the manual form', () => {
    const el = mount('<barcode-scanner manual-entry></barcode-scanner>');
    expect(q(el, '[data-manual]').hidden).toBe(false);
    el.removeAttribute('manual-entry');
    expect(q(el, '[data-manual]').hidden).toBe(true);
  });

  test('scans, looks up via lookup-url and renders the default result', async () => {
    const { streams } = stubGetUserMedia();
    const fetch = stubFetch({
      found: true,
      product: { barcode: EAN, name: 'Air Max', brand: 'Nike', styleCode: 'DD1', imageUrl: '/i.jpg', pageUrl: '/p/1' },
    });
    reads = [EAN, EAN];
    const el = mount('<barcode-scanner lookup-url="/api/lookup/{barcode}"></barcode-scanner>');
    const states = collect(el, 'barcode-state');
    const detects = collect(el, 'barcode-detect');
    const products = collect(el, 'barcode-product');

    q(el, '[data-start]').click();
    await vi.advanceTimersByTimeAsync(0);
    expect(el.scanner?.state).toBe('scanning');
    expect(q(el, '[data-start]').hidden).toBe(true);
    expect(q(el, '[data-stop]').hidden).toBe(false);
    expect(q(el, '[data-overlay]').hidden).toBe(false);
    expect(statusText(el)).toBe('Point your camera at a barcode.');

    await vi.advanceTimersByTimeAsync(500);

    expect(fetch.mock.calls[0][0]).toBe(`/api/lookup/${EAN}`);
    expect(detects).toHaveLength(1);
    expect(detects[0].detail).toEqual({ value: EAN, format: 'ean_13' });
    expect(detects[0].bubbles && detects[0].composed).toBe(true);
    expect(products).toHaveLength(1);
    expect(products[0].detail.product.name).toBe('Air Max');
    expect(states.map((e) => e.detail.state)).toEqual(['starting', 'scanning', 'looking-up', 'paused']);

    expect(q(el, '[data-result]').hidden).toBe(false);
    expect(q(el, '[data-product-name]').textContent).toBe('Air Max');
    expect(q(el, '[data-product-meta]').textContent).toBe('Nike · DD1');
    expect(q<HTMLImageElement>(el, '[data-product-image]').getAttribute('src')).toBe('/i.jpg');
    expect(q<HTMLAnchorElement>(el, '[data-product-link]').getAttribute('href')).toBe('/p/1');
    expect(q(el, '[data-product-link]').textContent).toBe('View product');
    expect(streams[0].track.stop).toHaveBeenCalled(); // paused for review
    expect(statusText(el)).toBe('Camera paused.');

    // "Scan again" hides the result and restarts the camera.
    q(el, '[data-again]').click();
    await vi.advanceTimersByTimeAsync(0);
    expect(q(el, '[data-result]').hidden).toBe(true);
    expect(el.scanner?.state).toBe('scanning');
  });

  test('not-found shows the message and keeps scanning', async () => {
    stubGetUserMedia();
    stubFetch({ found: false });
    reads = [EAN, EAN];
    const el = mount('<barcode-scanner lookup-url="/l/{barcode}"></barcode-scanner>');
    const misses = collect(el, 'barcode-not-found');
    await el.start();
    await vi.advanceTimersByTimeAsync(500);
    expect(misses).toHaveLength(1);
    expect(el.scanner?.state).toBe('scanning');
    expect(statusText(el)).toBe(`No product found for ${EAN}. Keep scanning or try another barcode.`);
  });

  test('scan-only mode (no lookup) just emits barcode-detect', async () => {
    stubGetUserMedia();
    const fetch = stubFetch({});
    reads = [EAN, EAN];
    const el = mount('<barcode-scanner mode="single"></barcode-scanner>');
    const detects = collect(el, 'barcode-detect');
    await el.start();
    await vi.advanceTimersByTimeAsync(500);
    expect(detects.map((e) => e.detail.value)).toEqual([EAN]);
    expect(fetch).not.toHaveBeenCalled();
    expect(el.scanner?.state).toBe('paused'); // single mode
  });

  test('translates error codes and re-emits barcode-error', async () => {
    stubGetUserMedia(async () => {
      throw new DOMException('denied', 'NotAllowedError');
    });
    const el = mount('<barcode-scanner></barcode-scanner>');
    const errors = collect(el, 'barcode-error');
    await el.start();
    expect(errors[0].detail.code).toBe('permission-denied');
    expect(statusText(el)).toBe('Camera permission was denied. Allow access in your browser settings.');
    expect(q(el, '[part~="status"]').getAttribute('part')).toBe('status status-error');
    expect(q(el, '[data-start]').hidden).toBe(false);
    expect(el.getAttribute('state')).toBe('error');
  });

  test('messages override: partial, nested, applied live', async () => {
    stubGetUserMedia(async () => {
      throw new DOMException('denied', 'NotAllowedError');
    });
    const el = mount('<barcode-scanner></barcode-scanner>');
    el.messages = { start: 'Démarrer', state: { idle: 'Caméra éteinte.' } };
    expect(q(el, '[data-start]').textContent).toBe('Démarrer');
    expect(q(el, '[data-stop]').textContent).toBe('Stop'); // untouched default
    expect(statusText(el)).toBe('Caméra éteinte.');
    expect(el.messages.state.scanning).toBe('Point your camera at a barcode.');

    await el.start();
    el.messages = { errors: { 'permission-denied': 'Accès refusé.' } };
    expect(statusText(el)).toBe('Accès refusé.'); // current status re-rendered
  });

  test('a slotted result is left untouched', async () => {
    stubGetUserMedia();
    stubFetch({ found: true, product: { barcode: EAN, name: 'Shoe' } });
    reads = [EAN, EAN];
    const el = mount(
      '<barcode-scanner lookup-url="/l/{barcode}"><div slot="result" id="mine">custom</div></barcode-scanner>',
    );
    await el.start();
    await vi.advanceTimersByTimeAsync(500);
    expect(q(el, '[data-result]').hidden).toBe(false);
    expect(document.getElementById('mine')!.textContent).toBe('custom');
    const slot = q<HTMLSlotElement>(el, 'slot[name="result"]');
    expect(slot.assignedElements()).toEqual([document.getElementById('mine')]);
  });

  test('restarting via start() (e.g. from a slotted button) hides the previous result', async () => {
    stubGetUserMedia();
    stubFetch({ found: true, product: { barcode: EAN, name: 'Shoe' } });
    reads = [EAN, EAN];
    const el = mount('<barcode-scanner lookup-url="/l/{barcode}"></barcode-scanner>');
    await el.start();
    await vi.advanceTimersByTimeAsync(500);
    expect(q(el, '[data-result]').hidden).toBe(false);
    const restarted = el.start();
    expect(q(el, '[data-result]').hidden).toBe(true);
    await restarted;
  });

  test('publishable-key attribute looks up with the Barcodes.gg API', async () => {
    stubGetUserMedia();
    const fetch = stubFetch({
      error: false,
      barcode: { barcode_value: EAN },
      product: { product_name: 'Dunk Low', product_brand: 'Nike', product_style_code: 'DD1391-100', product_image: 'https://barcodes.gg/api/image/uid/p1' },
    });
    reads = [EAN, EAN];
    const el = mount('<barcode-scanner publishable-key="pk_test1" lookup-url="/ignored/{barcode}"></barcode-scanner>');
    await el.start();
    await vi.advanceTimersByTimeAsync(500);
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://barcodes.gg/api/v2/barcode/lookup/${EAN}?fields=*`);
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer pk_test1');
    expect(q(el, '[data-product-name]').textContent).toBe('Dunk Low');
    expect(q(el, '[data-product-meta]').textContent).toBe('Nike \u00b7 DD1391-100');
    expect(q<HTMLAnchorElement>(el, '[data-product-link]').getAttribute('href')).toBe(`https://barcodes.gg/barcode/${EAN}`);
  });

  test('an invalid publishable key shows a neutral message and keeps scanning', async () => {
    stubGetUserMedia();
    stubFetch({ error: true, message: 'Invalid or expired publishable key.' }, 401);
    reads = [EAN, EAN];
    const el = mount('<barcode-scanner publishable-key="pk_revoked"></barcode-scanner>');
    const errors = collect(el, 'barcode-error');
    await el.start();
    await vi.advanceTimersByTimeAsync(500);
    expect(errors[0].detail.code).toBe('unauthorized');
    expect(statusText(el)).toBe('Product lookup is not available right now.');
    expect(el.scanner?.state).toBe('scanning');
  });

  test('a domain not allowed for the key is reported as origin-not-allowed', async () => {
    stubGetUserMedia();
    stubFetch({ error: true, message: 'This website (http://localhost:3000) is not an allowed domain for this publishable key.' }, 403);
    reads = [EAN, EAN];
    const el = mount('<barcode-scanner publishable-key="pk_test1"></barcode-scanner>');
    const errors = collect(el, 'barcode-error');
    await el.start();
    await vi.advanceTimersByTimeAsync(500);
    expect(errors[0].detail.code).toBe('origin-not-allowed');
    expect(errors[0].detail.error.cause).toMatch(/not an allowed domain/);
    expect(statusText(el)).toBe('Product lookup is not available on this website.');
  });

  test('a secret API key in publishable-key is never sent', async () => {
    stubGetUserMedia();
    const fetch = stubFetch({});
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    reads = [EAN, EAN];
    const el = mount('<barcode-scanner publishable-key="12|secretSanctumToken"></barcode-scanner>');
    const errors = collect(el, 'barcode-error');
    await el.start();
    await vi.advanceTimersByTimeAsync(500);
    expect(fetch).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(expect.stringMatching(/must start with "pk_"/));
    expect(errors[0].detail.code).toBe('unauthorized');
    expect(el.scanner?.state).toBe('scanning');
  });

  test('the lookup property wins over lookup-url', async () => {
    stubGetUserMedia();
    const fetch = stubFetch({});
    reads = [EAN, EAN];
    const el = mount('<barcode-scanner lookup-url="/l/{barcode}"></barcode-scanner>');
    const lookup = vi.fn(async (barcode: string) => ({ found: true as const, product: { barcode, name: 'Custom' } }));
    el.lookup = lookup;
    const products = collect(el, 'barcode-product');
    await el.start();
    await vi.advanceTimersByTimeAsync(500);
    expect(lookup).toHaveBeenCalledWith(EAN, expect.anything());
    expect(fetch).not.toHaveBeenCalled();
    expect(products[0].detail.product.name).toBe('Custom');
  });

  test('formats attribute is forwarded to the detector', async () => {
    stubGetUserMedia();
    const el = mount('<barcode-scanner formats="qr_code, ean_13"></barcode-scanner>');
    await el.start();
    expect(detectorCtor).toHaveBeenCalledWith({ formats: ['qr_code', 'ean_13'] });
  });

  test('changing an attribute while scanning rebuilds and keeps the camera on', async () => {
    const { getUserMedia } = stubGetUserMedia();
    const el = mount('<barcode-scanner></barcode-scanner>');
    await el.start();
    const first = el.scanner;
    el.setAttribute('formats', 'qr_code');
    await vi.advanceTimersByTimeAsync(0);
    expect(el.scanner).not.toBe(first);
    expect(el.scanner?.state).toBe('scanning');
    expect(getUserMedia).toHaveBeenCalledTimes(2);
  });

  test('manual entry submits to the lookup, validates input', async () => {
    stubGetUserMedia();
    const fetch = stubFetch({ found: true, product: { barcode: EAN, name: 'Typed' } });
    const el = mount('<barcode-scanner lookup-url="/l/{barcode}" manual-entry></barcode-scanner>');
    const input = q<HTMLInputElement>(el, '[data-manual-input]');
    const form = q<HTMLFormElement>(el, '[data-manual]');
    expect(input.placeholder).toBe('Enter barcode');

    input.value = '<bad>';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.advanceTimersByTimeAsync(0);
    expect(statusText(el)).toBe('Enter a valid barcode.');
    expect(fetch).not.toHaveBeenCalled();

    const detects = collect(el, 'barcode-detect');
    input.value = EAN;
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.advanceTimersByTimeAsync(0);
    expect(detects[0].detail).toEqual({ value: EAN, format: 'manual' });
    expect(q(el, '[data-product-name]').textContent).toBe('Typed');
    expect(q(el, '[data-result]').hidden).toBe(false);
  });

  test('autostart starts the camera on connect', async () => {
    stubGetUserMedia();
    const el = mount('<barcode-scanner autostart></barcode-scanner>');
    await vi.advanceTimersByTimeAsync(0);
    expect(el.scanner?.state).toBe('scanning');
  });

  test('removing the element releases the camera', async () => {
    const { streams } = stubGetUserMedia();
    const el = mount('<barcode-scanner></barcode-scanner>');
    await el.start();
    el.remove();
    expect(streams[0].track.stop).toHaveBeenCalled();
    expect(el.scanner).toBeUndefined();
  });

  test('shows the torch button only when the camera supports it', async () => {
    const { streams } = stubGetUserMedia(undefined, { torch: true });
    const el = mount('<barcode-scanner></barcode-scanner>');
    await el.start();
    await vi.advanceTimersByTimeAsync(0);
    const torch = q(el, '[data-torch]');
    expect(torch.hidden).toBe(false);
    torch.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(torch.getAttribute('aria-pressed')).toBe('true');
    expect(streams[0].track.applyConstraints).toHaveBeenLastCalledWith({ advanced: [{ torch: true }] });
    el.stop();
    expect(torch.hidden).toBe(true);

    stubGetUserMedia();
    const plain = mount('<barcode-scanner></barcode-scanner>');
    await plain.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(q(plain, '[data-torch]').hidden).toBe(true);
  });

  test('properties set before upgrade are applied', async () => {
    stubGetUserMedia();
    reads = [EAN, EAN];
    const el = document.createElement('late-scanner') as BarcodeScannerElement;
    const lookup = vi.fn(async (barcode: string) => ({ found: true as const, product: { barcode, name: 'Late' } }));
    (el as any).lookup = lookup;
    (el as any).messages = { start: 'Go' };
    document.body.append(el);
    customElements.define('late-scanner', class extends BarcodeScannerElement {});
    expect(q(el, '[data-start]').textContent).toBe('Go');
    await el.start();
    await vi.advanceTimersByTimeAsync(500);
    expect(lookup).toHaveBeenCalled();
  });
});
