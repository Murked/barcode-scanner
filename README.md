# @yourbrand/scanner

A drop-in, customizable barcode scanner for websites. Use it as a pure scanner (get the
scanned value) or plug in a lookup to fetch product data.

- **Headless core** — camera, detection loop, read confirmation, state, errors, tab
  visibility and lookup orchestration. Never creates DOM.
- **`<barcode-scanner>` web component** — ready-made UI, themable with CSS custom
  properties, `::part()`, slots and `messages`.
- **React hook** — `useBarcodeScanner()` for your own JSX.

Native `BarcodeDetector` when the browser has one, [zxing-wasm](https://github.com/Sec-ant/zxing-wasm)
otherwise (lazy-loaded chunk, so it costs nothing until `start()`).

```sh
npm install @yourbrand/scanner
```

## Quick start

### Web component

```html
<script type="module">import '@yourbrand/scanner/element';</script>

<!-- Scan-only -->
<barcode-scanner></barcode-scanner>

<!-- With a lookup via your own proxy, plus manual entry -->
<barcode-scanner lookup-url="/api/lookup/{barcode}" manual-entry></barcode-scanner>

<script>
  const el = document.querySelector('barcode-scanner');
  el.addEventListener('barcode-detect', (e) => console.log('scanned', e.detail.value));
  el.addEventListener('barcode-product', (e) => console.log('product', e.detail.product));
  el.addEventListener('barcode-error', (e) => console.warn(e.detail.code));
</script>
```

### Headless

```js
import { createScanner } from '@yourbrand/scanner';

const scanner = createScanner({
  video: document.querySelector('#cam'),
  mode: 'single',
  formats: ['ean_13', 'upc_a', 'qr_code'],
});

scanner.on('detect', ({ value }) => { document.querySelector('#sku').value = value; });
scanner.on('error', ({ code }) => alert(code));
document.querySelector('#scan').onclick = () => scanner.start();
```

### React

```tsx
import { useBarcodeScanner } from '@yourbrand/scanner/react';
import { urlLookup } from '@yourbrand/scanner';

export function Scanner() {
  const { videoRef, state, code, product, error, start, stop } = useBarcodeScanner({
    lookup: urlLookup('/api/lookup/{barcode}'),
  });
  return (
    <div>
      <video ref={videoRef} muted playsInline />
      {state === 'scanning' ? <button onClick={stop}>Stop</button> : <button onClick={start}>Scan</button>}
      {error && <p>{myErrorText[error.code]}</p>}
      {product && <ProductCard product={product} barcode={code!.value} />}
    </div>
  );
}
```

The hook also returns `notFound`, `pause`, `lookup`, `setTorch` and `scanner` (a ref to the
core instance), and accepts `onDetect`, `onProduct`, `onNotFound` and `onError`. Options
are read once on mount; callbacks and `lookup` always use the latest render's values.

## Core API

```ts
createScanner<P = Product>(options: ScannerOptions<P>): Scanner<P>
```

| Option | Default | |
|---|---|---|
| `video` | — | The `<video>` element to drive (required). |
| `formats` | `ean_13, ean_8, upc_a, upc_e, code_128, code_39` | Also `qr_code`, `itf`. |
| `mode` | `'continuous'` | `'single'` pauses after the first confirmed read. |
| `lookup` | — | `(value, { signal }) => Promise<LookupResult>`. Omit for scan-only. |
| `filter` | `defaultFilter` | GTIN checksum for retail formats (UPC-E via expansion), non-empty otherwise. Also applied to manual entry. |
| `confirmMs` | `1800` | Same value seen twice within this window → confirmed once. |
| `detector` | `'auto'` | `'native'`, `'zxing'` or your own `{ detect(video) }`. |
| `wasmUrl` | jsDelivr CDN | Self-hosted `zxing_reader.wasm` URL. |
| `camera` | `{ facingMode: 'environment', width: 1920, height: 1080 }` | Or `deviceId`. |
| `maxFps` | `15` | Max detection attempts per second. |
| `pauseWhenHidden` | `true` | Pause (release the camera) when the tab is hidden. |
| `vibrate` | `true` | `navigator.vibrate(35)` on each confirmed read. |

| Method | |
|---|---|
| `start()` | Request the camera and scan. Never rejects — failures arrive as `error` events. Concurrent calls share one start. |
| `stop()` | → `idle`, camera released, in-flight lookup aborted. |
| `pause()` | → `paused`, camera released. |
| `lookup(value)` | Manual entry: emits `detect` with `format: 'manual'`, then the lookup. Stops a live camera first. |
| `setTorch(on)` | Resolves `false` when unsupported. |
| `listCameras()` / `switchCamera(deviceId)` | Switching while live restarts the camera; while idle it applies on the next `start()`. |
| `on(event, fn)` | Returns an unsubscribe function. |
| `destroy()` | Stop and remove all listeners. |

### States

`idle` → `starting` → `scanning` ⇄ `looking-up` → `paused` / `idle`, or `error`.

While a camera lookup is in flight the camera stays on but detection is skipped. A hit
pauses the camera (so the user can review the result); a miss keeps scanning (in
`continuous` mode). The tab becoming hidden pauses; `pagehide` stops.

### Events

| Event | Payload |
|---|---|
| `state` | `ScannerState` |
| `detect` | `{ value, format }` — every confirmed read, camera or manual |
| `product` | `{ code, product }` — lookup hit |
| `not-found` | `{ code }` — lookup miss |
| `error` | `ScannerError` (`.code`) |

The state change is emitted **before** the outcome event (`product`, `not-found`, `error`),
so a UI that renders status text from both ends up showing the outcome.

### Error codes

The core never emits English — translate `error.code` yourself (the web component ships
default English `messages`).

| Code | Fatal (state → `error`) | Meaning |
|---|---|---|
| `unsupported` | yes | No `getUserMedia`. |
| `insecure-context` | yes | Not HTTPS / localhost. |
| `permission-denied` | yes | User or policy blocked the camera (also in-app browsers). |
| `no-camera` | yes | No matching camera. |
| `camera-in-use` | yes | Another app holds the camera. |
| `detector-failed` | yes | Native detector missing (`detector: 'native'`) or wasm failed to load. `start()` retries. |
| `invalid-input` | no | Manual value rejected. |
| `lookup-failed` | no | Lookup threw or the endpoint failed. Scanning continues. |
| `rate-limited` | no | Endpoint returned 429. |

### Lookup

`lookup` is just a function, so you can plug in your own database, Open Food Facts, or
(later) the Barcodes API. For a backend proxy use `urlLookup`:

```js
urlLookup('/api/lookup/{barcode}');                     // {barcode} is URL-encoded
urlLookup('/api/lookup/{barcode}', { credentials: 'include', headers: { 'X-Site': 'x' } });
urlLookup('/lookup/{barcode}', { mapProduct: (d) => ({ barcode: d.barcode, name: d.name, imageUrl: d.image_url }) });
```

| Response | Result |
|---|---|
| `200 { found: true, product }` or a bare product object | `product` |
| `200 { found: false }` or `404` | `not-found` |
| `429` | `error: rate-limited` |
| other non-2xx / network / invalid JSON | `error: lookup-failed` |

See [`examples/proxy-server`](examples/proxy-server) for Express and Laravel proxies.
`barcodesLookup()` (the branded Barcodes API helper with publishable keys) is reserved and
currently throws — it is out of scope for v1.

Other exports: `isValidGtin`, `expandUpcE`, `defaultFilter`, `createReadConfirmation`,
`ScannerError`, `RETAIL_FORMATS`, and all types.

## Web component

**Attributes:** `formats` (comma list), `lookup-url`, `mode`, `manual-entry`, `autostart`,
`wasm-url`. The element reflects its state as a `state="…"` attribute.
**Properties:** `lookup` (a `LookupFn`, wins over `lookup-url`), `messages`, `scanner`
(core instance, read-only).
**Methods:** `start()`, `stop()`.
**Events** (bubbling, composed): `barcode-state`, `barcode-detect`, `barcode-product`,
`barcode-not-found`, `barcode-error` (`detail: { code, error }`).

Changing an attribute rebuilds the core scanner (and restarts the camera if it was on).

### Customization levels

| Level | Example |
|---|---|
| 1. CSS custom properties | `barcode-scanner { --bs-accent: #e11d48; --bs-radius: 0; }` |
| 2. `::part()` | `barcode-scanner::part(start-button) { text-transform: uppercase; }` |
| 3. Slots | `<div slot="result">…</div>`, `<svg slot="overlay">` |
| 4. `messages` | `el.messages = { start: 'Démarrer', errors: { 'no-camera': 'Aucune caméra.' } }` |
| 5. Headless core | `createScanner({ video, … })` |

**Custom properties:** `--bs-accent`, `--bs-accent-text`, `--bs-bg`, `--bs-text`,
`--bs-muted`, `--bs-error`, `--bs-border`, `--bs-radius`, `--bs-gap`, `--bs-font`,
`--bs-aspect`, `--bs-viewfinder-bg`, `--bs-reticle`.

**Parts:** `root`, `viewfinder`, `video`, `overlay`, `reticle`, `idle`, `controls`, `button`,
`start-button`, `stop-button`, `torch-button`, `status` (+ `status-error` while showing an
error), `manual`, `manual-input`, `manual-button`, `result`, `product-image`,
`product-text`, `product-name`, `product-meta`, `product-link`, `again-button`.

**Slots:** `overlay` (replaces the reticle), `idle` (shown while the camera is off),
`controls` (replaces the default buttons — call `el.start()`/`el.stop()` yourself),
`status` (appended to the status line), `result` (replaces the default product card —
fill it from `barcode-product`; it is shown/hidden for you).

**`messages`** is a partial override; `state` and `errors` merge key by key. See
`defaultMessages` (exported from `@yourbrand/scanner/element`) for every key.

See [`examples/web-component-styled`](examples/web-component-styled) for levels 1–4 combined.

## Self-hosting the wasm

With no `wasmUrl`, zxing-wasm downloads `zxing_reader.wasm` (~1 MB, ~460 KB gzipped) from
jsDelivr on the first `start()` in browsers without a native detector. To self-host:

```js
// Vite
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';
createScanner({ video, wasmUrl });
```

```html
<barcode-scanner wasm-url="/assets/zxing_reader.wasm"></barcode-scanner>
```

`zxing-wasm` is installed as a dependency of `barcode-detector`; the wasm version must
match it (currently `zxing-wasm@3.1.3`).

## Browser behaviour

| Environment | Detector used | Notes |
|---|---|---|
| Chrome/Edge on Android, ChromeOS, some macOS | Native `BarcodeDetector` (`detector: 'auto'`) | Fastest, no wasm download |
| iOS Safari, Firefox, Windows desktop Chrome | zxing-wasm fallback | ~1 MB wasm on first `start()`, then cached |
| HTTP (non-localhost) | — | `insecure-context` error; manual entry still works |
| In-app browsers (Instagram, etc.) | varies | Camera often blocked → `permission-denied` |

`'auto'` uses the native detector only if it supports **every** requested format.

## Development

```sh
npm install
npm run typecheck && npm run lint
npm test            # Vitest + happy-dom (core, element, React)
npm run build       # tsup → dist/ (ESM + .d.ts, zxing in its own lazy chunk)
npx playwright install chromium firefox webkit
npm run e2e         # Chromium: fake camera playing test/fixtures/ean13.y4m
                    # Chromium/Firefox/WebKit: canvas-backed fake camera (cross-browser.spec.ts)
npm run size        # size-limit budgets
npm run serve       # examples at http://localhost:4173/examples/ (after build)
```

Camera tests skip on browser builds without media capture (Playwright's WebKit on
Windows); the zxing decoder and no-camera fallback are still tested there. The E2E fake-camera fixture is generated by `scripts/make-fixture.mjs` (pure Node, no
ffmpeg) on the first `npm run e2e`. Size budgets (minified + gzipped, excluding the lazy
wasm): core < 5 KB, element < 9 KB, React wrapper < 1 KB.

Releases use [Changesets](https://github.com/changesets/changesets): `npx changeset`, merge
to `main`, and the release workflow publishes with npm provenance.

Before every minor release, check by hand on real iOS Safari and Android Chrome — that's
where camera bugs live.

## License

MIT
