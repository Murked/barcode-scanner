# Barcode Scanner Library — Design

> **Status:** v1 implemented as `@barcodesgg/scanner`. Product lookup uses Barcodes.gg **publishable keys** (`pk_…`, created at https://barcodes.gg/dashboard/tokens): `barcodesLookup({ publishableKey })` / `<barcode-scanner publishable-key>` call `GET /api/v2/barcode/lookup/{barcode}` with `Authorization: Bearer pk_…`, restricted server-side to allowed domains. The README is the source of truth for the current API.

A drop-in, customizable barcode scanner for websites. Works as a pure scanner (returns the scanned value) or, when a lookup is supplied, fetches product data — optionally from our Barcodes API so it stays on brand.

> `@barcodesgg/scanner` is a placeholder package name throughout. Publishable keys for the branded Barcodes API are **out of scope for v1** — lookup is a pluggable function so a branded helper can be added later without API changes.

---

## 0. Background / reference implementation

This library is extracted from the scanner already running on the barcodes website (`C:\Users\Joe\Desktop\Projects\barcodes-new`):

| File | What it contains |
|---|---|
| `resources/js/barcode-scanner.js` | Camera start/stop, detection loop, lookup, UI glue (~220 lines) |
| `resources/js/scanner-confirmation.js` | `createReadConfirmation()` — one confirmed lookup per uninterrupted sighting |
| `resources/js/scanner-confirmation.test.js` | Tests for the above |
| `app/Http/Controllers/ScannerController.php` | Lookup endpoint returning a small public product preview |
| `resources/views/pages/tools/barcode-scanner.blade.php` | Markup (`data-*` hooks, `<dialog>` result) |

Proven behaviours to port:

- `barcode-detector/ponyfill` (zxing-wasm) with a **self-hosted wasm** via `prepareZXingModule({ overrides: { locateFile } })` — no CDN on our site.
- Formats: `ean_13, ean_8, upc_a, upc_e, code_128, code_39`.
- Camera: `facingMode: { ideal: 'environment' }`, ideal 1920×1080, `audio: false`.
- **Generation counter** to cancel stale async starts (stop during start, etc.).
- **Read confirmation**: same value seen twice within 1800 ms → confirmed once; reset when the code leaves view.
- Skip detection while a lookup request is in flight; `AbortController` on lookups.
- Pause camera when a product is found (review result), keep scanning on "not found".
- Pause on `visibilitychange` (tab hidden), stop on `pagehide`.
- Permission/secure-context error mapping; `navigator.vibrate(35)` on confirmed read.
- Manual entry fallback (8–15 digits).

---

## 1. Core idea

```
┌───────────────────────────────────────────────────────────┐
│  Integrator's page                                        │
│                                                           │
│   Option A: <barcode-scanner>   Option B: useBarcode-     │
│   web component (default UI,    Scanner() React hook      │
│   styleable)                    (their own JSX)           │
│            │                         │                    │
│            └──────────┬──────────────┘                    │
│                       ▼                                   │
│   createScanner()  ← headless core: OUR logic             │
│   camera · detection loop · confirmation · state ·        │
│   errors · tab-visibility · lookup orchestration          │
│        │                    │                             │
│        ▼                    ▼                             │
│   Detector              LookupFn (optional)               │
│   native BarcodeDetector   urlLookup('/api/{barcode}')    │
│   or zxing-wasm fallback   barcodesLookup({...}) (later)  │
│                            or their own function          │
└───────────────────────────────────────────────────────────┘
```

**Golden rule:** the core never creates DOM. It drives a `<video>` you give it and emits events. Every UI layer is a thin adapter.

**"Our logic, their UI"** is achieved by layering:

1. Headless core — full control, zero UI.
2. Web component — ready-made UI, themable via CSS variables, `::part()`, slots, and `messages`.
3. Framework hooks — React first; others only on demand (the web component already works everywhere).

---

## 2. Project structure

Single npm package with subpath exports for v1 (simpler than a monorepo; tree-shaken).

```
barcode-scanner/
├── package.json
├── tsconfig.json
├── tsup.config.ts              # builds ESM + .d.ts per entry
├── vitest.config.ts
├── playwright.config.ts
├── .size-limit.json            # bundle budget enforced in CI
├── .changeset/                 # versioning + changelog
├── .github/workflows/
│   ├── ci.yml                  # typecheck, lint, unit, e2e, size
│   └── release.yml             # changesets publish --provenance
├── src/
│   ├── index.ts                # public core exports
│   ├── scanner.ts              # createScanner(): lifecycle + state machine
│   ├── camera.ts               # getUserMedia, constraints, torch, device list
│   ├── confirm.ts              # createReadConfirmation (ported)
│   ├── validate.ts             # GTIN checksum, default value filter
│   ├── errors.ts               # ScannerError + codes
│   ├── emitter.ts              # tiny typed event emitter
│   ├── types.ts                # all public types
│   ├── detectors/
│   │   ├── index.ts            # loadDetector(): native → zxing fallback
│   │   ├── native.ts           # window.BarcodeDetector
│   │   └── zxing.ts            # barcode-detector/ponyfill (lazy chunk, wasm)
│   ├── lookup/
│   │   ├── index.ts            # urlLookup(), barcodesLookup() (stub for later)
│   │   └── types.ts            # Product, LookupResult
│   ├── element/
│   │   ├── index.ts            # registers <barcode-scanner>
│   │   ├── barcode-scanner.ts  # custom element class
│   │   ├── template.ts         # shadow DOM markup (parts + slots)
│   │   ├── styles.ts           # default CSS driven by custom properties
│   │   └── messages.ts         # default English strings, overridable
│   └── react/
│       └── index.ts            # useBarcodeScanner()
├── test/
│   ├── helpers.ts              # fakeVideo(), stubGetUserMedia()
│   ├── confirm.test.ts
│   ├── validate.test.ts
│   ├── scanner.test.ts         # fake detector + fake camera
│   ├── element.test.ts         # happy-dom
│   ├── e2e/scan.spec.ts        # real Chromium + fake camera feed
│   └── fixtures/ean13.y4m      # barcode video for the fake camera
├── examples/
│   ├── vanilla-headless/
│   ├── web-component/
│   ├── web-component-styled/
│   ├── react/
│   └── proxy-server/           # Express + Laravel lookup proxies
└── README.md
```

### package.json (key parts)

```json
{
  "name": "@barcodesgg/scanner",
  "version": "0.1.0",
  "type": "module",
  "sideEffects": ["./dist/element/index.js"],
  "exports": {
    ".":         { "types": "./dist/index.d.ts",         "import": "./dist/index.js" },
    "./element": { "types": "./dist/element/index.d.ts", "import": "./dist/element/index.js" },
    "./react":   { "types": "./dist/react/index.d.ts",   "import": "./dist/react/index.js" }
  },
  "files": ["dist"],
  "dependencies": {
    "barcode-detector": "^3.2.2"
  },
  "peerDependencies": { "react": ">=18" },
  "peerDependenciesMeta": { "react": { "optional": true } },
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "e2e": "playwright test",
    "size": "size-limit",
    "release": "changeset publish"
  }
}
```

### tsup.config.ts

```ts
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'element/index': 'src/element/index.ts',
    'react/index': 'src/react/index.ts',
  },
  format: ['esm'],
  dts: true,
  splitting: true,   // zxing detector stays in its own lazy chunk
  treeshake: true,
  external: ['react'],
});
```

### src/index.ts

```ts
export { createScanner } from './scanner';
export { urlLookup, barcodesLookup } from './lookup';
export { isValidGtin, defaultFilter } from './validate';
export { createReadConfirmation } from './confirm';
export { ScannerError } from './errors';
export type * from './types';
export type { ScannerErrorCode } from './errors';
```

---

## 3. Public types (the contract)

Event names and error codes are the long-term API contract — keep them stable.

```ts
// src/types.ts
import type { ScannerError } from './errors';

export type BarcodeFormat =
  | 'ean_13' | 'ean_8' | 'upc_a' | 'upc_e' | 'code_128' | 'code_39' | 'qr_code' | 'itf';

export type ScannerState = 'idle' | 'starting' | 'scanning' | 'looking-up' | 'paused' | 'error';

export interface DetectedCode {
  value: string;
  format: BarcodeFormat | 'manual';   // 'manual' = typed in, not scanned
}

export interface Product {            // placeholder shape — mirror the Barcodes API later
  barcode: string;
  name: string;
  brand?: string | null;
  styleCode?: string;
  imageUrl?: string;
  pageUrl?: string;
  raw?: unknown;                      // full payload for power users
}

export type LookupResult<P = Product> = { found: true; product: P } | { found: false };
export type LookupFn<P = Product> = (value: string, ctx: { signal: AbortSignal }) => Promise<LookupResult<P>>;

export interface Detector {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string; format: string }[]>;
}

export interface CameraOptions {
  facingMode?: 'environment' | 'user';
  deviceId?: string;
  width?: number;
  height?: number;
}

export interface ScannerOptions<P = Product> {
  video: HTMLVideoElement;
  formats?: BarcodeFormat[];                 // default: retail formats
  mode?: 'single' | 'continuous';            // single = pause after first confirmed read
  lookup?: LookupFn<P>;                      // omit → scan-only mode
  filter?: (code: DetectedCode) => boolean;  // default: GTIN checksum for retail formats
  confirmMs?: number;                        // default 1800
  detector?: 'auto' | 'native' | 'zxing' | Detector;
  wasmUrl?: string;                          // self-host zxing wasm
  camera?: CameraOptions;
  maxFps?: number;                           // default 15
  pauseWhenHidden?: boolean;                 // default true
  vibrate?: boolean;                         // default true
}

export interface ScannerEvents<P = Product> {
  state: ScannerState;
  detect: DetectedCode;                                   // every confirmed read
  product: { code: DetectedCode; product: P };            // lookup hit
  'not-found': { code: DetectedCode };                    // lookup miss
  error: ScannerError;
}

export interface Scanner<P = Product> {
  readonly state: ScannerState;
  start(): Promise<void>;
  stop(): void;                       // → idle, camera released
  pause(): void;                      // → paused, camera released
  lookup(value: string): Promise<LookupResult<P> | null>;   // manual entry
  setTorch(on: boolean): Promise<boolean>;                  // false if unsupported
  listCameras(): Promise<MediaDeviceInfo[]>;
  switchCamera(deviceId: string): Promise<void>;
  on<K extends keyof ScannerEvents<P>>(event: K, fn: (payload: ScannerEvents<P>[K]) => void): () => void;
  destroy(): void;
}
```

### Errors — codes, not messages

UI layers (and integrators) translate codes into words. The core never emits English.

```ts
// src/errors.ts
export type ScannerErrorCode =
  | 'unsupported'        // no getUserMedia
  | 'insecure-context'   // not HTTPS/localhost
  | 'permission-denied'
  | 'no-camera'
  | 'camera-in-use'
  | 'detector-failed'    // wasm failed to load, etc.
  | 'invalid-input'      // manual lookup value rejected
  | 'lookup-failed'
  | 'rate-limited';

export class ScannerError extends Error {
  constructor(public code: ScannerErrorCode, public cause?: unknown) {
    super(code);
    this.name = 'ScannerError';
  }
}

export function fromMediaError(e: unknown): ScannerError {
  const name = (e as DOMException)?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') return new ScannerError('permission-denied', e);
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return new ScannerError('no-camera', e);
  if (name === 'NotReadableError' || name === 'AbortError') return new ScannerError('camera-in-use', e);
  return new ScannerError('unsupported', e);
}
```

### Emitter

```ts
// src/emitter.ts
export function createEmitter<E extends Record<string, unknown>>() {
  const map = new Map<keyof E, Set<(p: any) => void>>();
  return {
    on<K extends keyof E>(event: K, fn: (payload: E[K]) => void) {
      if (!map.has(event)) map.set(event, new Set());
      map.get(event)!.add(fn);
      return () => { map.get(event)?.delete(fn); };
    },
    emit<K extends keyof E>(event: K, payload: E[K]) {
      map.get(event)?.forEach((fn) => { try { fn(payload); } catch (err) { console.error(err); } });
    },
    clear() { map.clear(); },
  };
}
```

---

## 4. Core implementation sketch

### scanner.ts

```ts
// src/scanner.ts
import { createEmitter } from './emitter';
import { createReadConfirmation } from './confirm';
import { defaultFilter } from './validate';
import { loadDetector } from './detectors';
import { openCamera, stopStream, setTorch as applyTorch } from './camera';
import { ScannerError, fromMediaError } from './errors';
import type {
  Scanner, ScannerOptions, ScannerState, ScannerEvents, DetectedCode, Product, BarcodeFormat, Detector,
} from './types';

const RETAIL: BarcodeFormat[] = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39'];

export function createScanner<P = Product>(options: ScannerOptions<P>): Scanner<P> {
  const o = {
    formats: RETAIL, mode: 'continuous' as const, confirmMs: 1800, detector: 'auto' as const,
    maxFps: 15, pauseWhenHidden: true, vibrate: true, filter: defaultFilter,
    ...options,
  };

  const events = createEmitter<ScannerEvents<P>>();
  let state: ScannerState = 'idle';
  let generation = 0;                       // cancels stale async work
  let stream: MediaStream | null = null;
  let inflight: AbortController | null = null;
  let detector: Promise<Detector> | null = null;
  let cancelFrame = () => {};

  const setState = (next: ScannerState) => {
    if (next === state) return;
    state = next;
    events.emit('state', next);
  };

  const fail = (err: ScannerError) => { release(); setState('error'); events.emit('error', err); };

  function release() {
    generation++;
    cancelFrame();
    inflight?.abort(); inflight = null;
    if (stream) stopStream(stream);
    stream = null;
    o.video.srcObject = null;
  }

  async function start() {
    if (state === 'starting' || state === 'scanning') return;
    if (!window.isSecureContext) return fail(new ScannerError('insecure-context'));
    if (!navigator.mediaDevices?.getUserMedia) return fail(new ScannerError('unsupported'));

    const run = ++generation;
    setState('starting');

    try {
      detector ??= loadDetector(o.detector, o.formats, o.wasmUrl);
      const d = await detector.catch((e) => { detector = null; throw new ScannerError('detector-failed', e); });
      if (run !== generation) return;

      const acquired = await openCamera(o.camera).catch((e) => { throw fromMediaError(e); });
      if (run !== generation) return stopStream(acquired);

      stream = acquired;
      o.video.muted = true;
      o.video.playsInline = true;
      o.video.srcObject = stream;
      await o.video.play();
      if (run !== generation) return;

      setState('scanning');
      runLoop(run, d);
    } catch (e) {
      if (run === generation) fail(e instanceof ScannerError ? e : fromMediaError(e));
    }
  }

  function runLoop(run: number, d: Detector) {
    const confirm = createReadConfirmation(o.confirmMs);
    const minGap = 1000 / o.maxFps;
    let last = 0;
    let busy = false;

    const tick = async (now: number) => {
      if (run !== generation) return;
      if (!busy && state === 'scanning' && now - last >= minGap && o.video.readyState >= 2) {
        busy = true; last = now;
        try {
          const [hit] = await d.detect(o.video);
          if (run !== generation) return;
          const code: DetectedCode | null = hit ? { value: hit.rawValue.trim(), format: hit.format as BarcodeFormat } : null;
          if (!code || !o.filter(code)) confirm('');
          else if (confirm(code.value)) await onConfirmed(code);
        } catch { /* undecodable frame */ }
        busy = false;
      }
      schedule();
    };

    // Prefer requestVideoFrameCallback (fires only on new frames), else rAF.
    const schedule = () => {
      if (run !== generation) return;
      const v = o.video as HTMLVideoElement & {
        requestVideoFrameCallback?: (cb: (now: number) => void) => number;
        cancelVideoFrameCallback?: (id: number) => void;
      };
      if (v.requestVideoFrameCallback) {
        const id = v.requestVideoFrameCallback((now) => void tick(now));
        cancelFrame = () => v.cancelVideoFrameCallback?.(id);
      } else {
        const id = requestAnimationFrame((now) => void tick(now));
        cancelFrame = () => cancelAnimationFrame(id);
      }
    };
    schedule();
  }

  async function onConfirmed(code: DetectedCode) {
    if (o.vibrate) try { navigator.vibrate?.(35); } catch { /* unsupported */ }
    events.emit('detect', code);
    if (o.lookup) await runLookup(code, true);
    else if (o.mode === 'single') pause();
  }

  async function runLookup(code: DetectedCode, fromCamera: boolean) {
    if (!o.lookup) return null;
    inflight?.abort();
    const ctrl = (inflight = new AbortController());
    const prev = state;
    setState('looking-up');
    try {
      const result = await o.lookup(code.value, { signal: ctrl.signal });
      if (ctrl.signal.aborted) return null;
      if (result.found) {
        events.emit('product', { code, product: result.product });
        if (fromCamera) pause();                 // pause on match (review result)
        else setState(prev === 'looking-up' ? 'idle' : prev);
      } else {
        events.emit('not-found', { code });
        setState(fromCamera ? 'scanning' : prev); // keep scanning on miss
      }
      return result;
    } catch (e) {
      if (ctrl.signal.aborted) return null;
      events.emit('error', e instanceof ScannerError ? e : new ScannerError('lookup-failed', e));
      setState(fromCamera ? 'scanning' : prev);
      return null;
    } finally {
      if (inflight === ctrl) inflight = null;
    }
  }

  async function manualLookup(value: string) {
    const v = value.trim();
    if (!/^[0-9A-Za-z\-. ]{1,64}$/.test(v)) {
      events.emit('error', new ScannerError('invalid-input'));
      return null;
    }
    if (state === 'starting' || state === 'scanning') stop();
    const code: DetectedCode = { value: v, format: 'manual' };
    events.emit('detect', code);
    return runLookup(code, false);
  }

  function pause() { release(); setState('paused'); }
  function stop()  { release(); setState('idle'); }

  const onVisibility = () => {
    if (document.hidden && (state === 'starting' || state === 'scanning')) pause();
  };
  if (o.pauseWhenHidden) document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', stop);

  return {
    get state() { return state; },
    start, stop, pause,
    lookup: manualLookup,
    setTorch: (on) => (stream ? applyTorch(stream, on) : Promise.resolve(false)),
    listCameras: async () =>
      (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput'),
    switchCamera: async (deviceId) => { o.camera = { ...o.camera, deviceId }; stop(); await start(); },
    on: events.on,
    destroy() {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', stop);
      events.clear();
    },
  };
}
```

Notes:
- While `looking-up` from the camera, `state !== 'scanning'` so the loop skips detection (same as the site's `!request` guard) but keeps the camera live.
- `release()` bumps `generation`, so any in-flight async step from a previous `start()` exits silently.

### Detectors — native first, wasm fallback

```ts
// src/detectors/index.ts
import type { BarcodeFormat, Detector } from '../types';
import { tryNative } from './native';

export async function loadDetector(
  pref: 'auto' | 'native' | 'zxing' | Detector,
  formats: BarcodeFormat[],
  wasmUrl?: string,
): Promise<Detector> {
  if (typeof pref === 'object') return pref;                 // injected (tests / custom engines)
  if (pref !== 'zxing') {
    const native = await tryNative(formats);
    if (native) return native;
    if (pref === 'native') throw new Error('Native BarcodeDetector unavailable');
  }
  const { createZxingDetector } = await import('./zxing');   // separate lazy chunk
  return createZxingDetector(formats, wasmUrl);
}
```

```ts
// src/detectors/native.ts
import type { BarcodeFormat, Detector } from '../types';

export async function tryNative(formats: BarcodeFormat[]): Promise<Detector | null> {
  const BD = (globalThis as any).BarcodeDetector;
  if (!BD?.getSupportedFormats) return null;
  try {
    const supported: string[] = await BD.getSupportedFormats();
    if (!formats.every((f) => supported.includes(f))) return null;   // all-or-nothing
    return new BD({ formats });
  } catch {
    return null;
  }
}
```

```ts
// src/detectors/zxing.ts
import { BarcodeDetector, prepareZXingModule } from 'barcode-detector/ponyfill';
import type { Detector } from '../types';

export function createZxingDetector(formats: string[], wasmUrl?: string): Detector {
  if (wasmUrl) {
    prepareZXingModule({
      overrides: {
        locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path),
      },
    });
  }
  return new BarcodeDetector({ formats: formats as any });
}
```

### Confirmation (ported unchanged)

```ts
// src/confirm.ts — from barcodes-new/resources/js/scanner-confirmation.js
// One confirmed read per uninterrupted sighting of a code.
export function createReadConfirmation(windowMs = 1800) {
  let lastValue = '';
  let lastAt = 0;
  let attempted = '';

  return (value: string, now = Date.now()): boolean => {
    if (!value) {
      lastValue = '';
      attempted = '';
      return false;
    }
    if (value === attempted) return false;
    if (value === lastValue && now - lastAt < windowMs) {
      attempted = value;
      return true;
    }
    lastValue = value;
    lastAt = now;
    return false;
  };
}
```

### Validation

```ts
// src/validate.ts
import type { DetectedCode } from './types';

const GTIN_FORMATS = new Set(['ean_13', 'ean_8', 'upc_a', 'upc_e']);

export function isValidGtin(v: string): boolean {
  if (!/^(\d{8}|\d{12,14})$/.test(v)) return false;
  const digits = [...v].map(Number);
  const check = digits.pop()!;
  const sum = digits.reverse().reduce((s, d, i) => s + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

// Filters most misreads before they reach confirmation or the API.
export const defaultFilter = ({ value, format }: DetectedCode) =>
  GTIN_FORMATS.has(format) ? isValidGtin(value) : value.length > 0;
```

> Note: UPC-E reads may need expansion to UPC-A before checksum validation depending on what the detector returns — verify against real reads and adjust.

### Camera helpers

```ts
// src/camera.ts
import type { CameraOptions } from './types';

export function openCamera(c: CameraOptions = {}) {
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      ...(c.deviceId
        ? { deviceId: { exact: c.deviceId } }
        : { facingMode: { ideal: c.facingMode ?? 'environment' } }),
      width: { ideal: c.width ?? 1920 },
      height: { ideal: c.height ?? 1080 },
    },
  });
}

export const stopStream = (s: MediaStream) => s.getTracks().forEach((t) => t.stop());

export async function setTorch(stream: MediaStream, on: boolean) {
  const track = stream.getVideoTracks()[0];
  const caps = track?.getCapabilities?.() as (MediaTrackCapabilities & { torch?: boolean }) | undefined;
  if (!caps?.torch) return false;
  await track.applyConstraints({ advanced: [{ torch: on } as any] });
  return true;
}
```

### Lookup helpers — pluggable now, branded later

```ts
// src/lookup/index.ts
import { ScannerError } from '../errors';
import type { LookupFn, Product } from '../types';

/** Proxy mode: the integrator's backend holds any secret. `{barcode}` is replaced. */
export function urlLookup(template: string, init: RequestInit = {}): LookupFn<Product> {
  return async (value, { signal }) => {
    const res = await fetch(template.replace('{barcode}', encodeURIComponent(value)), {
      ...init,
      signal,
      headers: { Accept: 'application/json', ...(init.headers as Record<string, string>) },
    });
    if (res.status === 404) return { found: false };
    if (res.status === 429) throw new ScannerError('rate-limited');
    if (!res.ok) throw new ScannerError('lookup-failed');
    const data = await res.json();
    return data.found === false ? { found: false } : { found: true, product: data.product ?? data };
  };
}

/** Branded Barcodes API lookup — implemented once publishable keys exist. */
export function barcodesLookup(_opts: { key: string; baseUrl?: string }): LookupFn<Product> {
  throw new Error('barcodesLookup is not available yet');
}
```

Because `lookup` is just a function, integrators can plug in Open Food Facts, their own DB, or our API — the core doesn't care.

---

## 5. Web component (`@barcodesgg/scanner/element`)

### Usage

```html
<script type="module">import '@barcodesgg/scanner/element';</script>

<!-- Scan-only -->
<barcode-scanner></barcode-scanner>

<!-- With lookup via their proxy -->
<barcode-scanner lookup-url="/api/lookup/{barcode}" mode="continuous" manual-entry></barcode-scanner>

<script>
  const el = document.querySelector('barcode-scanner');
  el.addEventListener('barcode-detect',  (e) => console.log('scanned', e.detail.value));
  el.addEventListener('barcode-product', (e) => console.log('product', e.detail.product));
  el.addEventListener('barcode-error',   (e) => console.warn(e.detail.code));
</script>
```

**Attributes:** `formats` (comma list), `lookup-url`, `mode`, `manual-entry`, `autostart`.
**Properties (JS only):** `lookup` (LookupFn), `messages` (partial overrides), `scanner` (core instance, escape hatch).
**Methods:** `start()`, `stop()`.
**Events (bubbling, composed):** `barcode-state`, `barcode-detect`, `barcode-product`, `barcode-not-found`, `barcode-error`.

### Template — parts & slots are the customization surface

```ts
// src/element/template.ts
export const template = /* html */ `
<div part="root">
  <div part="viewfinder">
    <video part="video" muted playsinline></video>
    <slot name="overlay"><div part="reticle"></div></slot>
    <div part="idle" data-idle><slot name="idle"></slot></div>
  </div>

  <div part="controls">
    <slot name="controls">
      <button part="button start-button" data-start type="button"></button>
      <button part="button stop-button"  data-stop  type="button" hidden></button>
      <button part="button torch-button" data-torch type="button" hidden></button>
    </slot>
  </div>

  <p part="status" role="status" aria-live="polite"><span data-status-text></span><slot name="status"></slot></p>

  <form part="manual" data-manual hidden>
    <input part="manual-input" inputmode="numeric" autocomplete="off">
    <button part="button manual-button" type="submit"></button>
  </form>

  <div part="result" data-result hidden>
    <slot name="result">
      <img part="product-image" alt="">
      <div part="product-text">
        <strong part="product-name"></strong>
        <span part="product-meta"></span>
      </div>
      <a part="product-link"></a>
      <button part="button again-button" data-again type="button"></button>
    </slot>
  </div>
</div>`;
```

### Default styles — everything via custom properties

```ts
// src/element/styles.ts
export const styles = /* css */ `
:host {
  --bs-accent: #2563eb;
  --bs-accent-text: #fff;
  --bs-bg: #fff;
  --bs-text: #111827;
  --bs-muted: #6b7280;
  --bs-radius: 12px;
  --bs-font: inherit;
  --bs-aspect: 4 / 3;
  --bs-reticle: rgb(255 255 255 / .85);
  display: block; font-family: var(--bs-font); color: var(--bs-text);
}
[hidden] { display: none !important; }
[part="viewfinder"] { position: relative; aspect-ratio: var(--bs-aspect); border-radius: var(--bs-radius); overflow: hidden; background: #000; }
[part="video"] { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
[part="reticle"] { position: absolute; inset: 30% 12%; border: 2px solid var(--bs-reticle); border-radius: 8px; pointer-events: none; }
[part~="button"] { background: var(--bs-accent); color: var(--bs-accent-text); border: 0; border-radius: calc(var(--bs-radius) / 1.5); padding: .6em 1.1em; font: inherit; cursor: pointer; }
[part="status"] { color: var(--bs-muted); min-height: 1.5em; }
`;
```

### Messages

```ts
// src/element/messages.ts
import type { ScannerState } from '../types';
import type { ScannerErrorCode } from '../errors';

export interface Messages {
  start: string; stop: string; torch: string; manualButton: string; manualPlaceholder: string;
  again: string; viewProduct: string;
  state: Record<ScannerState, string>;
  notFound: (value: string) => string;
  errors: Record<ScannerErrorCode, string>;
}

export const defaultMessages: Messages = {
  start: 'Start camera', stop: 'Stop', torch: 'Torch', manualButton: 'Look up',
  manualPlaceholder: 'Enter barcode', again: 'Scan again', viewProduct: 'View product',
  state: {
    idle: 'Camera off.',
    starting: 'Starting camera… Allow camera access if prompted.',
    scanning: 'Point your camera at a barcode.',
    'looking-up': 'Looking up…',
    paused: 'Camera paused.',
    error: '',
  },
  notFound: (v) => `No product found for ${v}. Keep scanning or try another barcode.`,
  errors: {
    unsupported: 'This browser cannot access a camera. Enter a barcode instead.',
    'insecure-context': 'Camera access needs HTTPS. Enter a barcode instead.',
    'permission-denied': 'Camera permission was denied. Allow access in your browser settings.',
    'no-camera': 'No camera found.',
    'camera-in-use': 'The camera is in use by another app.',
    'detector-failed': 'The scanner failed to load. Please refresh.',
    'invalid-input': 'Enter a valid barcode.',
    'lookup-failed': 'Lookup is unavailable right now. Please try again.',
    'rate-limited': 'Too many lookups. Please wait a minute.',
  },
};
```

### Element class — thin adapter over the core

```ts
// src/element/barcode-scanner.ts
import { createScanner, urlLookup } from '../index';
import type { Scanner, LookupFn, Product, BarcodeFormat } from '../types';
import { template } from './template';
import { styles } from './styles';
import { defaultMessages, type Messages } from './messages';

export class BarcodeScannerElement extends HTMLElement {
  static observedAttributes = ['formats', 'lookup-url', 'mode', 'manual-entry'];

  #scanner?: Scanner;
  #lookup?: LookupFn;
  #messages: Messages = defaultMessages;
  #root = this.attachShadow({ mode: 'open' });
  #$ = <T extends Element = HTMLElement>(sel: string) => this.#root.querySelector<T>(sel)!;

  set lookup(fn: LookupFn | undefined) { this.#lookup = fn; if (this.isConnected) this.#rebuild(); }
  set messages(m: Partial<Messages>) { this.#messages = { ...defaultMessages, ...m }; this.#renderText(); }
  get scanner() { return this.#scanner; }

  start() { return this.#scanner?.start(); }
  stop()  { this.#scanner?.stop(); }

  connectedCallback() {
    this.#root.innerHTML = `<style>${styles}</style>${template}`;
    this.#renderText();
    this.#$('[data-start]').addEventListener('click', () => this.start());
    this.#$('[data-stop]').addEventListener('click', () => this.stop());
    this.#$('[data-torch]').addEventListener('click', () => this.#toggleTorch());
    this.#$('[data-again]').addEventListener('click', () => { this.#showResult(null); this.start(); });
    this.#$<HTMLFormElement>('[data-manual]').addEventListener('submit', (e) => {
      e.preventDefault();
      this.#scanner?.lookup(this.#$<HTMLInputElement>('[part="manual-input"]').value);
    });
    this.#rebuild();
    if (this.hasAttribute('autostart')) this.start();
  }

  disconnectedCallback() { this.#scanner?.destroy(); this.#scanner = undefined; }
  attributeChangedCallback() { if (this.isConnected && this.#scanner) this.#rebuild(); }

  #rebuild() {
    this.#scanner?.destroy();
    const lookupUrl = this.getAttribute('lookup-url');
    this.#$('[data-manual]').hidden = !this.hasAttribute('manual-entry');

    const s = (this.#scanner = createScanner({
      video: this.#$<HTMLVideoElement>('video'),
      formats: (this.getAttribute('formats')?.split(',').map((f) => f.trim()) as BarcodeFormat[]) ?? undefined,
      mode: (this.getAttribute('mode') as 'single' | 'continuous') ?? 'continuous',
      lookup: this.#lookup ?? (lookupUrl ? urlLookup(lookupUrl) : undefined),
    }));

    s.on('state', (state) => {
      const live = state === 'starting' || state === 'scanning' || state === 'looking-up';
      this.#$('[data-start]').hidden = live;
      this.#$('[data-stop]').hidden = !live;
      this.#$('[data-idle]').hidden = live;
      if (state !== 'error') this.#status(this.#messages.state[state]);
      this.#emit('barcode-state', { state });
    });
    s.on('detect', (code) => this.#emit('barcode-detect', code));
    s.on('not-found', (d) => { this.#status(this.#messages.notFound(d.code.value)); this.#emit('barcode-not-found', d); });
    s.on('product', (d) => { this.#showResult(d.product as Product); this.#emit('barcode-product', d); });
    s.on('error', (err) => { this.#status(this.#messages.errors[err.code]); this.#emit('barcode-error', { code: err.code }); });
  }

  async #toggleTorch() { /* track on/off; hide button if setTorch returns false */ }

  #showResult(p: Product | null) {
    const box = this.#$('[data-result]');
    box.hidden = !p;
    if (!p) return;
    // Fills only the DEFAULT result markup; slotted custom results use the event instead.
    const img = this.#$<HTMLImageElement>('[part="product-image"]');
    img.hidden = !p.imageUrl; if (p.imageUrl) img.src = p.imageUrl;
    this.#$('[part="product-name"]').textContent = p.name;
    this.#$('[part="product-meta"]').textContent = [p.brand, p.styleCode].filter(Boolean).join(' · ');
    const link = this.#$<HTMLAnchorElement>('[part="product-link"]');
    link.hidden = !p.pageUrl; if (p.pageUrl) link.href = p.pageUrl;
  }

  #status(text: string) { this.#$('[data-status-text]').textContent = text; }

  #renderText() {
    if (!this.#root.firstChild) return;
    const m = this.#messages;
    this.#$('[data-start]').textContent = m.start;
    this.#$('[data-stop]').textContent = m.stop;
    this.#$('[data-torch]').textContent = m.torch;
    this.#$('[part~="manual-button"]').textContent = m.manualButton;
    this.#$<HTMLInputElement>('[part="manual-input"]').placeholder = m.manualPlaceholder;
    this.#$('[data-again]').textContent = m.again;
    this.#$('[part="product-link"]').textContent = m.viewProduct;
  }

  #emit(name: string, detail: unknown) {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }
}
```

```ts
// src/element/index.ts
import { BarcodeScannerElement } from './barcode-scanner';
if (!customElements.get('barcode-scanner')) customElements.define('barcode-scanner', BarcodeScannerElement);
export { BarcodeScannerElement };

declare global {
  interface HTMLElementTagNameMap { 'barcode-scanner': BarcodeScannerElement; }
}
```

### The five customization levels

| Level | Effort | Example |
|---|---|---|
| 1. CSS custom properties | 1 line | `barcode-scanner { --bs-accent: #e11d48; --bs-radius: 0; }` |
| 2. `::part()` | Any CSS on internals | `barcode-scanner::part(start-button) { text-transform: uppercase; }` |
| 3. Slots | Replace pieces with own HTML | `<div slot="result">…</div>`, `<svg slot="overlay">` |
| 4. `messages` | Wording / i18n | `el.messages = { start: 'Démarrer' }` |
| 5. Headless core | Full control, zero UI | `createScanner({ video, … })` |

### Themed example (levels 1–3 combined)

```html
<style>
  barcode-scanner {
    --bs-accent: #0f766e;
    --bs-radius: 20px;
    --bs-aspect: 1 / 1;
    --bs-font: 'Inter', sans-serif;
  }
  barcode-scanner::part(reticle) { inset: 35% 10%; border-style: dashed; }
  barcode-scanner::part(status)  { text-align: center; font-size: .875rem; }
</style>

<barcode-scanner lookup-url="/api/lookup/{barcode}">
  <div slot="idle" class="my-placeholder">Tap "Start" to scan</div>

  <div slot="result" class="my-card">
    <img id="p-img"><h3 id="p-name"></h3>
    <button onclick="this.closest('barcode-scanner').start()">Scan another</button>
  </div>
</barcode-scanner>

<script type="module">
  import '@barcodesgg/scanner/element';
  document.querySelector('barcode-scanner').addEventListener('barcode-product', ({ detail }) => {
    document.getElementById('p-img').src = detail.product.imageUrl;
    document.getElementById('p-name').textContent = detail.product.name;
  });
</script>
```

---

## 6. React hook (`@barcodesgg/scanner/react`)

```ts
// src/react/index.ts
import { useEffect, useRef, useState, useCallback } from 'react';
import { createScanner } from '../index';
import type { Scanner, ScannerOptions, ScannerState, DetectedCode, Product } from '../types';
import type { ScannerError } from '../errors';

export function useBarcodeScanner<P = Product>(
  options: Omit<ScannerOptions<P>, 'video'> & {
    onDetect?: (c: DetectedCode) => void;
    onProduct?: (p: P, c: DetectedCode) => void;
  } = {},
) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerRef = useRef<Scanner<P>>();
  const opts = useRef(options);
  opts.current = options;                     // latest callbacks without re-init

  const [state, setState] = useState<ScannerState>('idle');
  const [code, setCode] = useState<DetectedCode | null>(null);
  const [product, setProduct] = useState<P | null>(null);
  const [error, setError] = useState<ScannerError | null>(null);

  useEffect(() => {
    const { onDetect, onProduct, ...init } = opts.current;
    const s = createScanner<P>({
      ...init,
      video: videoRef.current!,
      lookup: init.lookup && ((v, ctx) => opts.current.lookup!(v, ctx)),
    });
    scannerRef.current = s;
    const offs = [
      s.on('state', setState),
      s.on('detect', (c) => { setCode(c); setError(null); opts.current.onDetect?.(c); }),
      s.on('product', ({ code, product }) => { setProduct(product); opts.current.onProduct?.(product, code); }),
      s.on('error', setError),
    ];
    return () => { offs.forEach((off) => off()); s.destroy(); };
  }, []);

  return {
    videoRef, state, code, product, error,
    start: useCallback(() => scannerRef.current?.start(), []),
    stop: useCallback(() => scannerRef.current?.stop(), []),
    lookup: useCallback((v: string) => scannerRef.current?.lookup(v), []),
    scanner: scannerRef,
  };
}
```

Usage — fully their own JSX:

```tsx
import { useBarcodeScanner } from '@barcodesgg/scanner/react';
import { urlLookup } from '@barcodesgg/scanner';

export function Scanner() {
  const { videoRef, state, code, product, error, start, stop } = useBarcodeScanner({
    lookup: urlLookup('/api/lookup/{barcode}'),
    onDetect: (c) => console.log(c.value),
  });

  return (
    <div className="rounded-2xl overflow-hidden">
      <video ref={videoRef} className="aspect-square w-full object-cover bg-black" />
      {state === 'scanning' ? <button onClick={stop}>Stop</button> : <button onClick={start}>Scan</button>}
      {error && <p className="text-red-600">{errorText[error.code]}</p>}
      {product && <ProductCard product={product} barcode={code!.value} />}
    </div>
  );
}
```

---

## 7. Headless vanilla usage (scan-only)

```js
import { createScanner } from '@barcodesgg/scanner';

const scanner = createScanner({
  video: document.querySelector('#cam'),
  mode: 'single',
  formats: ['ean_13', 'upc_a', 'qr_code'],
});

scanner.on('detect', ({ value }) => {
  document.querySelector('#sku').value = value;   // e.g. fill a form field
});
scanner.on('error', ({ code }) => alert(code));

document.querySelector('#scan').onclick = () => scanner.start();
```

---

## 8. Proxy examples (lookup without exposing secrets)

Recommended pattern until publishable keys exist. Lives in `examples/proxy-server/`.

```js
// Express
app.get('/api/lookup/:barcode', async (req, res) => {
  const r = await fetch(`https://api.yourbrand.com/v1/barcodes/${encodeURIComponent(req.params.barcode)}`, {
    headers: { Authorization: `Bearer ${process.env.BARCODES_API_KEY}` },
  });
  if (r.status === 404) return res.json({ found: false });
  const p = await r.json();
  res.json({ found: true, product: { barcode: p.barcode, name: p.name, brand: p.brand, imageUrl: p.image } });
});
```

```php
// Laravel
Route::get('/api/lookup/{barcode}', function (string $barcode) {
    $r = Http::withToken(config('services.barcodes.key'))
        ->get("https://api.yourbrand.com/v1/barcodes/{$barcode}");

    return $r->notFound()
        ? ['found' => false]
        : ['found' => true, 'product' => Arr::only($r->json(), ['barcode', 'name', 'brand', 'image'])];
})->middleware('throttle:30,1');
```

(API URLs and response field names are placeholders — align with the real Barcodes API.)

---

## 9. Dogfooding: how barcodes-new would consume it

`barcodes-new/resources/js/barcode-scanner.js` shrinks to UI glue. Blade markup and dialog stay. The controller either returns `{ found, product }` or a small adapter lookup function maps its current flat shape.

```js
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';
import { createScanner, urlLookup } from '@barcodesgg/scanner';

const root = document.querySelector('[data-barcode-scanner]');
if (root) {
  const $ = (s) => root.querySelector(s);
  const messages = {
    'permission-denied': 'Camera permission was denied. Allow access in your browser settings or enter the number below.',
    'insecure-context':  'Camera access needs HTTPS (or localhost) and a compatible browser. Enter a barcode below instead.',
    'rate-limited':      'Too many lookups. Please wait a minute before trying again.',
    // …
  };

  const scanner = createScanner({
    video: $('[data-preview]'),
    wasmUrl,                 // keep self-hosting the wasm
    detector: 'zxing',       // or 'auto' to try native first
    lookup: urlLookup(root.dataset.lookupUrl.replace('__BARCODE__', '{barcode}')),
  });

  scanner.on('state', (s) => {
    $('[data-start]').hidden = s === 'starting' || s === 'scanning';
    $('[data-stop]').hidden  = !$('[data-start]').hidden;
  });
  scanner.on('product', ({ code, product }) => showMatch(code.value, product));   // existing dialog code
  scanner.on('not-found', ({ code }) => setStatus(`No product found for ${code.value}. Keep scanning…`));
  scanner.on('error', ({ code }) => setStatus(messages[code] ?? 'Something went wrong.'));

  $('[data-start]').onclick = () => scanner.start();
  $('[data-stop]').onclick  = () => scanner.stop();
  $('[data-manual-form]').onsubmit = (e) => { e.preventDefault(); scanner.lookup($('[data-manual-input]').value); };
  // showMatch / showManualMatch / setStatus — unchanged from today
}
```

If the API feels awkward here, it will feel awkward to everyone — use this as the acceptance test.

---

## 10. Testing

### Unit (Vitest) — no camera needed thanks to detector injection

```ts
// test/scanner.test.ts
import { createScanner, isValidGtin } from '../src';
import { fakeVideo, stubGetUserMedia } from './helpers';

test('confirms a code after two sightings, then looks it up once', async () => {
  vi.useFakeTimers();
  stubGetUserMedia();
  const reads = ['5012345678900', '5012345678900', '5012345678900'];
  const detector = { detect: vi.fn(async () => [{ rawValue: reads.shift() ?? '', format: 'ean_13' }]) };
  const lookup = vi.fn(async () => ({ found: true as const, product: { barcode: 'x', name: 'Shoe' } }));

  const s = createScanner({ video: fakeVideo(), detector, lookup });
  const onProduct = vi.fn();
  s.on('product', onProduct);

  await s.start();
  await vi.advanceTimersByTimeAsync(500);

  expect(lookup).toHaveBeenCalledTimes(1);
  expect(onProduct).toHaveBeenCalledWith(expect.objectContaining({ product: expect.objectContaining({ name: 'Shoe' }) }));
  expect(s.state).toBe('paused');
});

test('maps NotAllowedError to permission-denied', async () => { /* … */ });
test('stop() during start() cancels the stale start', async () => { /* … */ });
test('not-found keeps scanning', async () => { /* … */ });
test('pauses when the tab is hidden', async () => { /* … */ });
test('rejects EAN with a bad checksum', () => { expect(isValidGtin('5012345678901')).toBe(false); });
```

Also port `barcodes-new/resources/js/scanner-confirmation.test.js` to `test/confirm.test.ts`.

### Element (Vitest + happy-dom)

Attributes → options, events re-emitted, default result rendering, slotted result untouched, `messages` override applied.

### E2E (Playwright) — real decoder, fake camera

```ts
// playwright.config.ts
use: {
  launchOptions: {
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--use-file-for-fake-video-capture=test/fixtures/ean13.y4m',
    ],
  },
},
```

```ts
// test/e2e/scan.spec.ts
test('web component scans and emits barcode-detect', async ({ page }) => {
  await page.goto('/examples/web-component/');
  const detected = page.evaluate(() => new Promise((r) =>
    document.querySelector('barcode-scanner')!.addEventListener('barcode-detect', (e: any) => r(e.detail.value))));
  await page.getByRole('button', { name: 'Start camera' }).click();
  expect(await detected).toBe('5012345678900');
});
```

Fixture: `ffmpeg -loop 1 -i ean13.png -t 5 -pix_fmt yuv420p test/fixtures/ean13.y4m`.

Manual check on real iOS Safari + Android Chrome before every minor release — that's where camera bugs live.

---

## 11. Tooling, CI & release

- **TypeScript**, built with **tsup**, ESM-only.
- **size-limit** budgets (excluding the lazily loaded wasm): core < 5 KB gz, element < 9 KB gz, react < 1 KB gz. CI fails on regression.
- **GitHub Actions:** typecheck → lint → unit → Playwright → size on every PR.
- **Changesets** for versions/changelog; `npm publish --provenance` from CI.
- **License:** MIT.
- **Docs:** README + a page on the barcodes site (e.g. `/developers/scanner`) with a live demo; README links there (SEO/brand value).

---

## 12. Browser behaviour to document

| Environment | Detector used | Notes |
|---|---|---|
| Chrome/Edge on Android, ChromeOS, some macOS | Native `BarcodeDetector` (`detector: 'auto'`) | Fastest, no wasm download |
| iOS Safari, Firefox, Windows desktop Chrome | zxing-wasm fallback | ~1 MB wasm on first `start()`, then cached |
| HTTP (non-localhost) | — | `insecure-context` error; manual entry still works |
| In-app browsers (Instagram, etc.) | varies | Camera often blocked → `permission-denied` |

---

## 13. Build order & effort (v1)

| # | Piece | Estimate |
|---|---|---|
| 1 | Scaffold: package.json, tsconfig, tsup, vitest, lint, CI | 0.5 day |
| 2 | Core: types, errors, emitter, confirm, validate, camera, detectors, scanner, lookup helpers + unit tests | 1.5–2 days |
| 3 | Web component: template, styles, messages, element + tests | 1–1.5 days |
| 4 | React hook | 0.5 day |
| 5 | Playwright fake-camera E2E | 0.5 day |
| 6 | Examples + README | 1 day |
| 7 | Dogfood in barcodes-new (separate change in that repo) | 0.5 day |
| | **Total** | **~5–7 days** |

**Out of scope for v1:** publishable keys / `barcodesLookup` implementation, Vue/Svelte wrappers, scanning from image files, multi-barcode detection, analytics. Add on demand.

---

## 14. Open decisions

1. **Package name & npm scope** (e.g. `@barcodesgg/scanner`) and GitHub org.
2. **Default wasm source:** CDN (zero-config) vs. require self-host. Recommendation: CDN default, documented `wasmUrl` self-host option.
3. **Default detector:** `'auto'` (native first) vs. always zxing for consistent results. Recommendation: `'auto'`.
4. **Manual entry in the element:** opt-in via `manual-entry` attribute (recommended).
5. **License:** MIT (recommended).
6. **Product shape:** finalize `Product` fields to match the Barcodes API response.
