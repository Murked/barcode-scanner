# @barcodesgg/scanner

[![npm](https://img.shields.io/npm/v/@barcodesgg/scanner.svg)](https://www.npmjs.com/package/@barcodesgg/scanner)
[![license](https://img.shields.io/npm/l/@barcodesgg/scanner.svg)](LICENSE)

A drop-in barcode scanner for websites, from [Barcodes.gg](https://barcodes.gg).

Point a phone or webcam at a barcode and get the value back, or add a Barcodes.gg API
token and get the matching product (name, brand, style code, image) too.

- **Works with or without a token.** Scan-only out of the box; product lookup with a token.
- **Three ways to use it:** a `<barcode-scanner>` web component with a ready-made UI, a
  React hook for your own UI, or a headless core for anything else.
- **Fast and accurate.** Uses the browser's built-in barcode detector where available and
  falls back to a WebAssembly decoder (zxing) everywhere else. Each code is read twice
  before it counts, with GTIN check-digit validation to filter misreads.
- **Handles the camera edge cases:** permissions, HTTPS, switching tabs, cameras in use,
  torch, multiple cameras.
- **Small.** About 3 KB gzipped for the core and 7 KB with the default UI. The decoder
  only downloads when the camera starts, and only in browsers that need it.
- **Fully typed.** Written in TypeScript, ships ESM and type definitions.

> Looking for the full Barcodes.gg API (product search, SKU lookups, usage)? Use
> [`@barcodesgg/sdk`](https://github.com/Murked/barcodes-js-sdk). This package is just the scanner.

## Contents

- [Installation](#installation)
- [Quick start](#quick-start)
- [Web component](#web-component)
- [React](#react)
- [Headless core](#headless-core)
- [Looking up products](#looking-up-products)
- [Keeping your token safe](#keeping-your-token-safe)
- [Customizing the look](#customizing-the-look)
- [API reference](#api-reference)
- [Browser support](#browser-support)
- [Self-hosting the decoder](#self-hosting-the-decoder)
- [Development](#development)

## Installation

```bash
npm install @barcodesgg/scanner
```

The camera only works on HTTPS pages (and `localhost` during development).

## Quick start

### Scan only (no token)

```html
<script type="module">
  import '@barcodesgg/scanner/element';
</script>

<barcode-scanner></barcode-scanner>

<script>
  document.querySelector('barcode-scanner').addEventListener('barcode-detect', (e) => {
    console.log('Scanned', e.detail.value); // "5012345678900"
  });
</script>
```

### With a Barcodes.gg token

Add your token and the scanner looks up every barcode it reads, then shows the product.

```html
<barcode-scanner token="YOUR_API_TOKEN" manual-entry></barcode-scanner>

<script>
  document.querySelector('barcode-scanner').addEventListener('barcode-product', (e) => {
    console.log(e.detail.product.name, e.detail.product.styleCode);
  });
</script>
```

Read [Keeping your token safe](#keeping-your-token-safe) before you put a token on a
public page.

## Web component

`import '@barcodesgg/scanner/element'` registers `<barcode-scanner>`. It renders a camera
viewfinder, start/stop/torch buttons, a status line, optional manual entry and a product
card.

```html
<barcode-scanner token="YOUR_API_TOKEN" manual-entry></barcode-scanner>
```

### Attributes

| Attribute | Description |
|---|---|
| `token` | Barcodes.gg API token. Enables product lookup. |
| `lookup-url` | Your own lookup endpoint instead of a token, e.g. `/api/lookup/{barcode}`. See [Looking up products](#looking-up-products). |
| `formats` | Comma-separated barcode formats. Default: `ean_13,ean_8,upc_a,upc_e,code_128,code_39`. |
| `mode` | `continuous` (default) keeps scanning after a code that isn't found. `single` stops after the first read. |
| `manual-entry` | Show a text field for typing a barcode by hand. |
| `autostart` | Start the camera as soon as the element is on the page. Browsers still ask for permission. |
| `wasm-url` | Where to load the decoder from. See [Self-hosting the decoder](#self-hosting-the-decoder). |

The element also reflects its current state as a `state` attribute (`idle`, `starting`,
`scanning`, `looking-up`, `paused`, `error`), which is handy for styling.

### Properties and methods

| Member | Description |
|---|---|
| `el.start()` / `el.stop()` | Start or stop the camera. |
| `el.lookup` | A custom [lookup function](#custom-lookup). Overrides `token` and `lookup-url`. |
| `el.messages` | Change any text in the UI. See [Text and translations](#4-text-and-translations). |
| `el.scanner` | The underlying [core scanner](#headless-core), for advanced use. |

### Events

All events bubble and cross shadow DOM boundaries.

| Event | `event.detail` | When |
|---|---|---|
| `barcode-detect` | `{ value, format }` | A barcode was read (or typed in). |
| `barcode-product` | `{ code, product }` | The lookup found a product. |
| `barcode-not-found` | `{ code }` | The lookup found nothing. |
| `barcode-error` | `{ code, error }` | Something went wrong. See [error codes](#error-codes). |
| `barcode-state` | `{ state }` | The scanner's state changed. |

When a product is found the camera pauses so the user can review it, and **Scan again**
restarts it.

## React

```bash
npm install @barcodesgg/scanner react
```

```tsx
import { barcodesLookup } from '@barcodesgg/scanner';
import { useBarcodeScanner } from '@barcodesgg/scanner/react';

const lookup = barcodesLookup({ token: import.meta.env.VITE_BARCODES_TOKEN });

export function ProductScanner() {
  const { videoRef, state, product, notFound, error, start, stop } = useBarcodeScanner({ lookup });
  const live = state === 'starting' || state === 'scanning' || state === 'looking-up';

  return (
    <div>
      <video ref={videoRef} muted playsInline style={{ width: '100%' }} />
      {live ? <button onClick={stop}>Stop</button> : <button onClick={start}>Scan</button>}

      {product && <p>{product.name} · {product.styleCode}</p>}
      {notFound && <p>No product for {notFound.value}</p>}
      {error && <p>Error: {error.code}</p>}
    </div>
  );
}
```

Leave out `lookup` for scan-only. `useBarcodeScanner(options)` takes the same
[options](#options) as the core (except `video`), plus `onDetect`, `onProduct`, `onNotFound`
and `onError` callbacks. It returns:

| Value | Description |
|---|---|
| `videoRef` | Attach to your `<video>` element. |
| `state` | Current [state](#states). |
| `code` | Last scanned `{ value, format }`. |
| `product` / `notFound` | Result of the last lookup. |
| `error` | Last error, if any. |
| `start()`, `stop()`, `pause()`, `lookup(value)`, `setTorch(on)` | Controls. |
| `scanner` | Ref to the core scanner. |

Options are read once when the component mounts. Callbacks and `lookup` always use the
latest values. The camera is released when the component unmounts.

## Headless core

Bring your own markup. The core drives a `<video>` element and tells you what happened.

```js
import { createScanner } from '@barcodesgg/scanner';

const scanner = createScanner({
  video: document.querySelector('video'),
  mode: 'single',
});

scanner.on('detect', ({ value }) => {
  document.querySelector('#sku').value = value;
});
scanner.on('error', ({ code }) => {
  console.warn('Scanner error:', code);
});

document.querySelector('#scan').addEventListener('click', () => scanner.start());
```

## Looking up products

You choose how lookups happen, or skip them completely.

| Setup | How | Token location |
|---|---|---|
| Scan only | No `token`, `lookup-url` or `lookup` | — |
| Barcodes.gg API | `token="…"` or `barcodesLookup({ token })` | In the page |
| Your own server | `lookup-url="…"` or `urlLookup(url)` | On your server |
| Anything else | `lookup` = your own function | Up to you |

### Barcodes.gg API

```js
import { createScanner, barcodesLookup } from '@barcodesgg/scanner';

createScanner({ video, lookup: barcodesLookup({ token: 'YOUR_API_TOKEN' }) });
```

This calls `GET https://barcodes.gg/api/v2/barcode/lookup/{barcode}`, the same endpoint as
`sdk.barcodes.lookup()` in `@barcodesgg/sdk`. Products come back as:

```ts
{
  barcode: '196153412345',
  name: 'Air Jordan 1 Low',
  brand: 'Jordan',
  styleCode: 'DZ5485-612',
  imageUrl: 'https://barcodes.gg/api/image/uid/…',
  pageUrl: 'https://barcodes.gg/barcode/196153412345',
  raw: { /* the full API response: colorway, sizes, release date, retail price, … */ },
}
```

`raw` is typed as `BarcodesLookupResponse`. Lookups that find a product use API calls
from your token.

### Your own server

Keep the token on your server and point the scanner at your endpoint. `{barcode}` is
replaced with the scanned value:

```html
<barcode-scanner lookup-url="/api/lookup/{barcode}"></barcode-scanner>
```

```js
import { createScanner, urlLookup } from '@barcodesgg/scanner';
createScanner({ video, lookup: urlLookup('/api/lookup/{barcode}') });
```

Your endpoint should return `{ "found": true, "product": { … } }` or `{ "found": false }`.
Ready-made [Express (using `@barcodesgg/sdk`) and Laravel examples](examples/proxy-server)
are included. To adapt a different response shape, use
`urlLookup(url, { mapProduct: (data) => ({ … }) })`.

### Custom lookup

Any async function works:

```js
createScanner({
  video,
  lookup: async (barcode, { signal }) => {
    const item = await myDatabase.find(barcode, { signal });
    return item ? { found: true, product: { barcode, name: item.title } } : { found: false };
  },
});
```

`signal` is aborted if the user stops the scanner mid-lookup.

## Keeping your token safe

A token in a web page (the `token` attribute or `barcodesLookup`) can be seen by anyone
who views the page source. That's fine for internal tools and prototypes. For a public
site:

- **Use a separate token for the scanner**, so you can revoke it without affecting
  anything else and track its usage on its own.
- **Or keep the token on your server** and use [`lookup-url`](#your-own-server), which also
  lets you add your own rate limiting and caching.

If a token is invalid, revoked or out of API calls, the scanner keeps scanning and reports
an `unauthorized` or `quota-exceeded` error. The default UI shows a neutral "Product lookup
is not available right now." message.

## Customizing the look

The web component can be customized in layers, from one line of CSS to a fully custom UI.

### 1. CSS custom properties

```css
barcode-scanner {
  --bs-accent: #e11d48;
  --bs-radius: 20px;
  --bs-aspect: 1 / 1;
}
```

| Property | Default | |
|---|---|---|
| `--bs-accent` / `--bs-accent-text` | `#2563eb` / `#fff` | Buttons and links |
| `--bs-text` / `--bs-muted` / `--bs-error` | `#111827` / `#6b7280` / `#b91c1c` | Text colours |
| `--bs-bg` / `--bs-border` | `#fff` / `#e5e7eb` | Cards and inputs |
| `--bs-radius` / `--bs-gap` | `12px` / `.75rem` | Shape and spacing |
| `--bs-font` | `inherit` | Font family |
| `--bs-aspect` | `4 / 3` | Viewfinder aspect ratio |
| `--bs-viewfinder-bg` / `--bs-reticle` | `#000` / white | Viewfinder |

### 2. Parts

Style any internal element with `::part()`:

```css
barcode-scanner::part(start-button) { width: 100%; text-transform: uppercase; }
barcode-scanner::part(reticle) { border-style: dashed; }
barcode-scanner[state="scanning"]::part(viewfinder) { outline: 3px solid #16a34a; }
```

Parts: `root`, `viewfinder`, `video`, `overlay`, `reticle`, `idle`, `controls`, `button`,
`start-button`, `stop-button`, `torch-button`, `status`, `status-error`, `manual`,
`manual-input`, `manual-button`, `result`, `product-image`, `product-text`,
`product-name`, `product-meta`, `product-link`, `again-button`.

### 3. Slots

Replace pieces with your own HTML:

```html
<barcode-scanner token="YOUR_API_TOKEN">
  <div slot="idle">Tap “Start camera” to scan</div>

  <div slot="result" class="my-card">
    <img id="p-img" alt="" />
    <h3 id="p-name"></h3>
  </div>
</barcode-scanner>

<script>
  document.querySelector('barcode-scanner').addEventListener('barcode-product', ({ detail }) => {
    document.getElementById('p-img').src = detail.product.imageUrl;
    document.getElementById('p-name').textContent = detail.product.name;
  });
</script>
```

| Slot | Replaces |
|---|---|
| `overlay` | The scanning frame over the camera |
| `idle` | Content shown while the camera is off |
| `controls` | The start/stop/torch buttons (call `el.start()` / `el.stop()` yourself) |
| `status` | Extra content after the status text |
| `result` | The product card. It's shown and hidden for you; fill it from `barcode-product`. |

### 4. Text and translations

```js
el.messages = {
  start: 'Démarrer',
  state: { scanning: 'Visez un code-barres.' },
  errors: { 'permission-denied': "Autorisez l'accès à la caméra." },
};
```

Only the keys you pass change. See `defaultMessages` (exported from
`@barcodesgg/scanner/element`) for every key.

### 5. Your own UI

For complete control, use the [React hook](#react) or the [headless core](#headless-core).

## API reference

### `createScanner(options)`

#### Options

| Option | Default | Description |
|---|---|---|
| `video` | — | **Required.** The `<video>` element to show the camera in. |
| `lookup` | — | Lookup function (`barcodesLookup`, `urlLookup` or your own). Omit for scan-only. |
| `formats` | Retail formats¹ | Formats to read: `ean_13`, `ean_8`, `upc_a`, `upc_e`, `code_128`, `code_39`, `qr_code`, `itf`. |
| `mode` | `'continuous'` | `'single'` pauses after the first read. |
| `filter` | GTIN check | `(code) => boolean`. Reject reads (and typed values) you don't want. |
| `confirmMs` | `1800` | A code must be seen twice within this many ms to count. |
| `camera` | Back camera | `{ facingMode, deviceId, width, height }` |
| `detector` | `'auto'` | `'auto'`, `'native'`, `'zxing'` or a custom `{ detect(video) }`. |
| `wasmUrl` | CDN | Where to load the zxing decoder from. |
| `maxFps` | `15` | Maximum detection attempts per second. |
| `pauseWhenHidden` | `true` | Release the camera when the tab is hidden. |
| `vibrate` | `true` | Short vibration on each read (supported phones). |

¹ `ean_13`, `ean_8`, `upc_a`, `upc_e`, `code_128`, `code_39`

#### Methods

| Method | Description |
|---|---|
| `start()` | Ask for the camera and start scanning. Never throws; problems arrive as `error` events. |
| `stop()` | Stop scanning and release the camera. |
| `pause()` | Same as `stop()`, but the state becomes `paused`. |
| `lookup(value)` | Look up a typed-in barcode. Resolves with the result, or `null`. |
| `setTorch(on)` | Turn the flashlight on or off. Resolves `false` if the camera has none. |
| `listCameras()` | List available cameras (labels appear after permission is granted). |
| `switchCamera(deviceId)` | Use a different camera. |
| `on(event, fn)` | Listen to an event. Returns a function that removes the listener. |
| `destroy()` | Stop and remove all listeners. |
| `state` | The current state. |

#### Events

| Event | Payload |
|---|---|
| `detect` | `{ value, format }`. `format` is `'manual'` for typed-in values. |
| `product` | `{ code, product }` |
| `not-found` | `{ code }` |
| `error` | `ScannerError` with a `code` |
| `state` | The new state |

#### States

| State | Meaning |
|---|---|
| `idle` | Camera off. |
| `starting` | Waiting for the camera (and permission). |
| `scanning` | Looking for barcodes. |
| `looking-up` | Looking up a product. |
| `paused` | Camera off after a match or when the tab was hidden. |
| `error` | The camera couldn't start. See the error code. |

### Error codes

Errors carry a stable `code` rather than a message, so you can show your own wording.

| Code | Meaning | Camera |
|---|---|---|
| `permission-denied` | The user or browser blocked the camera. | Stops |
| `no-camera` | No camera found. | Stops |
| `camera-in-use` | Another app is using the camera. | Stops |
| `insecure-context` | Page isn't on HTTPS. | Stops |
| `unsupported` | The browser can't access cameras. | Stops |
| `detector-failed` | The decoder couldn't load. `start()` tries again. | Stops |
| `unauthorized` | The token is invalid, revoked or not allowed to look up barcodes. | Keeps scanning |
| `quota-exceeded` | The token has no API calls left. | Keeps scanning |
| `rate-limited` | Too many lookups in a short time. | Keeps scanning |
| `lookup-failed` | The lookup failed (network or server error). | Keeps scanning |
| `invalid-input` | A typed-in barcode isn't valid. | — |

### Other exports

| Export | Description |
|---|---|
| `barcodesLookup({ token, baseUrl? })` | Barcodes.gg API lookup. |
| `urlLookup(url, init?)` | Lookup through your own endpoint. |
| `isValidGtin(value)` | Check an EAN/UPC/GTIN check digit. |
| `expandUpcE(value)` | Convert an 8-digit UPC-E to UPC-A. |
| `defaultFilter`, `createReadConfirmation`, `RETAIL_FORMATS` | Building blocks used by the scanner. |
| `ScannerError` | Error class with a `code`. |

All types (`Product`, `ScannerOptions`, `ScannerErrorCode`, `BarcodesLookupResponse`, …)
are exported too.

## Browser support

| Browser | Decoder | Notes |
|---|---|---|
| Chrome / Edge on Android, ChromeOS, macOS | Built-in | Fastest, nothing extra to download |
| Safari (iOS and macOS), Firefox, Chrome on Windows | zxing (WebAssembly) | ~460 KB download (gzipped) on first scan, then cached |
| Any browser over plain HTTP | — | Camera unavailable; manual entry still works |
| In-app browsers (Instagram, TikTok, …) | Varies | Often block the camera; manual entry still works |

The built-in decoder is only used if it supports every format you asked for.

## Self-hosting the decoder

In browsers without a built-in barcode detector, the zxing decoder (`zxing_reader.wasm`)
loads from the jsDelivr CDN by default. To serve it yourself, pass its URL:

```js
// With Vite
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';
createScanner({ video, wasmUrl });
```

```html
<barcode-scanner wasm-url="/assets/zxing_reader.wasm"></barcode-scanner>
```

The file is in the `zxing-wasm` package, installed alongside this one. Use the copy from
`node_modules/zxing-wasm/dist/reader/` so the version matches.

## Development

```bash
npm install
npm test              # unit tests
npm run build
npm run e2e           # browser tests (run `npx playwright install` once first)
npm run serve         # examples at http://localhost:4173/examples/
```

Also available: `npm run typecheck`, `npm run lint` and `npm run size`. The
[examples](examples) folder has a plain web component, a themed one, a headless page, a
React app and server-side lookup proxies. Open the web component example with
`?token=YOUR_API_TOKEN` to try live lookups.

## License

MIT © Barcodes.gg
