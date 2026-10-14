import { createEmitter } from './emitter';
import { createReadConfirmation } from './confirm';
import { defaultFilter } from './validate';
import { loadDetector } from './detectors';
import { openCamera, stopStream, setTorch as applyTorch } from './camera';
import { ScannerError, fromMediaError } from './errors';
import type {
  BarcodeFormat,
  DetectedCode,
  Detector,
  LookupResult,
  Product,
  Scanner,
  ScannerEvents,
  ScannerOptions,
  ScannerState,
} from './types';

export const RETAIL_FORMATS: BarcodeFormat[] = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39'];

/** Accepted shape for manual entry before `filter` runs. */
const MANUAL_INPUT = /^[0-9A-Za-z\-. ]{1,64}$/;

type FrameVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: (now: number) => void) => number;
  cancelVideoFrameCallback?: (id: number) => void;
};

/**
 * Headless scanner core. Never creates DOM: it drives the `<video>` you pass in and
 * emits events. All UI layers (web component, React hook) are thin adapters over this.
 */
export function createScanner<P = Product>(options: ScannerOptions<P>): Scanner<P> {
  const o = {
    formats: RETAIL_FORMATS,
    mode: 'continuous' as const,
    confirmMs: 1800,
    detector: 'auto' as const,
    maxFps: 15,
    pauseWhenHidden: true,
    vibrate: true,
    filter: defaultFilter,
    ...stripUndefined(options),
  };
  if (!o.formats.length) o.formats = RETAIL_FORMATS;

  const events = createEmitter<ScannerEvents<P>>();
  let state: ScannerState = 'idle';
  let generation = 0; // bumping it cancels every stale async step
  let stream: MediaStream | null = null;
  let inflight: AbortController | null = null;
  let detector: Promise<Detector> | null = null;
  let starting: Promise<void> | null = null;
  let cancelFrame = () => {};
  let destroyed = false;

  const setState = (next: ScannerState) => {
    if (next === state) return;
    state = next;
    events.emit('state', next);
  };

  /** Camera on (or coming on). */
  const isActive = () =>
    state === 'starting' || state === 'scanning' || (state === 'looking-up' && stream !== null);

  const fail = (err: ScannerError) => {
    release();
    setState('error');
    events.emit('error', err);
  };

  function release() {
    generation++;
    cancelFrame();
    cancelFrame = () => {};
    inflight?.abort();
    inflight = null;
    if (stream) stopStream(stream);
    stream = null;
    o.video.srcObject = null;
  }

  function start(): Promise<void> {
    if (destroyed) return Promise.resolve();
    if (starting) return starting;
    if (isActive()) return Promise.resolve();
    return launch();
  }

  function launch(): Promise<void> {
    const p = (starting = run().finally(() => {
      if (starting === p) starting = null;
    }));
    return p;
  }

  async function run() {
    if (typeof window === 'undefined' || window.isSecureContext === false) {
      return fail(new ScannerError('insecure-context'));
    }
    if (!navigator.mediaDevices?.getUserMedia) return fail(new ScannerError('unsupported'));

    inflight?.abort(); // starting the camera cancels a pending manual lookup
    inflight = null;
    const gen = ++generation;
    setState('starting');

    try {
      detector ??= loadDetector(o.detector, o.formats, o.wasmUrl);
      const d = await detector.catch((e) => {
        detector = null; // allow a retry on the next start()
        throw new ScannerError('detector-failed', e);
      });
      if (gen !== generation) return;

      const acquired = await openCamera(o.camera).catch((e) => {
        throw fromMediaError(e);
      });
      if (gen !== generation) return stopStream(acquired);

      stream = acquired;
      o.video.muted = true;
      o.video.playsInline = true;
      o.video.setAttribute?.('playsinline', '');
      o.video.srcObject = stream;
      await o.video.play();
      if (gen !== generation) return;

      setState('scanning');
      loop(gen, d);
    } catch (e) {
      if (gen === generation) fail(fromMediaError(e));
    }
  }

  function loop(gen: number, d: Detector) {
    const confirm = createReadConfirmation(o.confirmMs);
    const minGap = 1000 / o.maxFps;
    let last = -Infinity;

    const tick = async (now: number) => {
      if (gen !== generation) return;
      if (state === 'scanning' && now - last >= minGap && o.video.readyState >= 2) {
        last = now;
        try {
          const hits = await d.detect(o.video);
          if (gen !== generation) return;
          const code = hits
            .map((h): DetectedCode => ({ value: String(h.rawValue ?? '').trim(), format: h.format as BarcodeFormat }))
            .find((c) => c.value && o.filter(c));
          if (!code) confirm('');
          else if (confirm(code.value)) await onConfirmed(code);
        } catch {
          /* undecodable frame */
        }
      }
      schedule();
    };

    // Prefer requestVideoFrameCallback (fires only on new frames), else rAF.
    const schedule = () => {
      if (gen !== generation) return;
      const v = o.video as FrameVideo;
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
    if (o.vibrate) {
      try {
        navigator.vibrate?.(35);
      } catch {
        /* unsupported */
      }
    }
    const gen = generation;
    events.emit('detect', code);
    if (gen !== generation) return; // a listener stopped/paused the scanner
    if (o.lookup) await runLookup(code, true);
    else if (o.mode === 'single') pause();
  }

  /** Where a manual lookup leaves the scanner. */
  const restingState = (prev: ScannerState): ScannerState =>
    prev === 'paused' ? 'paused' : 'idle';

  async function runLookup(code: DetectedCode, fromCamera: boolean): Promise<LookupResult<P> | null> {
    const lookup = o.lookup;
    if (!lookup) return null;
    inflight?.abort();
    const ctrl = (inflight = new AbortController());
    const prev = state;
    setState('looking-up');

    // State settles first, then the outcome is emitted, so UIs that render status from
    // both `state` and outcome events end up showing the outcome.
    const afterRead = () => (o.mode === 'single' ? pause() : setState('scanning'));

    try {
      const result = await lookup(code.value, { signal: ctrl.signal });
      if (ctrl.signal.aborted) return null;
      inflight = null;
      if (result.found) {
        // Pause on a camera match so the user can review the result.
        if (fromCamera) pause();
        else setState(restingState(prev));
        events.emit('product', { code, product: result.product });
      } else {
        // Keep scanning on a miss (continuous mode).
        if (fromCamera) afterRead();
        else setState(restingState(prev));
        events.emit('not-found', { code });
      }
      return result;
    } catch (e) {
      if (ctrl.signal.aborted) return null;
      inflight = null;
      setState(fromCamera ? 'scanning' : restingState(prev));
      events.emit('error', e instanceof ScannerError ? e : new ScannerError('lookup-failed', e));
      return null;
    } finally {
      if (inflight === ctrl) inflight = null;
    }
  }

  async function manualLookup(value: string): Promise<LookupResult<P> | null> {
    if (destroyed) return null;
    const v = String(value ?? '').trim();
    const code: DetectedCode = { value: v, format: 'manual' };
    if (!MANUAL_INPUT.test(v) || !o.filter(code)) {
      events.emit('error', new ScannerError('invalid-input'));
      return null;
    }
    if (isActive()) stop();
    events.emit('detect', code);
    return runLookup(code, false);
  }

  function pause() {
    release();
    if (state !== 'idle' && state !== 'error') setState('paused');
  }

  function stop() {
    release();
    setState('idle');
  }

  const onVisibility = () => {
    if (document.hidden && isActive()) pause();
  };
  const onPageHide = () => {
    if (state !== 'idle' && state !== 'error') stop();
  };
  const hasDom = typeof document !== 'undefined' && typeof window !== 'undefined';
  if (hasDom && o.pauseWhenHidden) document.addEventListener('visibilitychange', onVisibility);
  if (hasDom) window.addEventListener('pagehide', onPageHide);

  return {
    get state() {
      return state;
    },
    start,
    stop,
    pause,
    lookup: manualLookup,
    setTorch: (on) => (stream ? applyTorch(stream, on) : Promise.resolve(false)),
    listCameras: async () => {
      if (!navigator.mediaDevices?.enumerateDevices) return [];
      return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
    },
    async switchCamera(deviceId) {
      o.camera = { ...o.camera, deviceId };
      if (!isActive()) return; // applies on the next start()
      release(); // stays 'scanning' until the new start() moves to 'starting' (no idle flicker)
      await launch();
    },
    on: events.on,
    destroy() {
      if (destroyed) return;
      stop();
      destroyed = true;
      if (hasDom) {
        document.removeEventListener('visibilitychange', onVisibility);
        window.removeEventListener('pagehide', onPageHide);
      }
      events.clear();
    },
  };
}

function stripUndefined<T extends object>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}
