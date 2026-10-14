import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createScanner, ScannerError, type LookupFn, type Scanner, type ScannerState } from '../src';
import {
  EAN,
  deferred,
  fakeVideo,
  queuedDetector,
  setHidden,
  setSecureContext,
  stubGetUserMedia,
} from './helpers';

const found = (name = 'Shoe') =>
  vi.fn<LookupFn>(async (barcode) => ({ found: true as const, product: { barcode, name } }));
const notFound = () => vi.fn<LookupFn>(async () => ({ found: false as const }));

let scanners: Scanner<any>[] = [];
function make(opts: Parameters<typeof createScanner>[0]) {
  const s = createScanner(opts);
  scanners.push(s);
  return s;
}

function recordStates(s: Scanner<any>) {
  const states: ScannerState[] = [];
  s.on('state', (st) => states.push(st));
  return states;
}

beforeEach(() => {
  vi.useFakeTimers();
  setSecureContext(true);
  setHidden(false);
});

afterEach(() => {
  scanners.forEach((s) => s.destroy());
  scanners = [];
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('start / camera', () => {
  test('confirms a code after two sightings, then looks it up once', async () => {
    const { streams, getUserMedia } = stubGetUserMedia();
    const detector = queuedDetector([EAN, EAN, EAN], 'ean_13', EAN);
    const lookup = found();
    const video = fakeVideo();

    const s = make({ video, detector, lookup });
    const onProduct = vi.fn();
    const onDetect = vi.fn();
    s.on('product', onProduct);
    s.on('detect', onDetect);

    await s.start();
    expect(s.state).toBe('scanning');
    expect(video.srcObject).toBe(streams[0].stream);
    expect(video.muted).toBe(true);
    expect(video.playsInline).toBe(true);
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    });

    await vi.advanceTimersByTimeAsync(500);

    expect(lookup).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledWith(EAN, { signal: expect.any(AbortSignal) });
    expect(onDetect).toHaveBeenCalledTimes(1);
    expect(onDetect).toHaveBeenCalledWith({ value: EAN, format: 'ean_13' });
    expect(onProduct).toHaveBeenCalledWith({
      code: { value: EAN, format: 'ean_13' },
      product: expect.objectContaining({ name: 'Shoe' }),
    });
    // Pauses on a match so the user can review it; camera released.
    expect(s.state).toBe('paused');
    expect(streams[0].track.stop).toHaveBeenCalled();
    expect(video.srcObject).toBeNull();
  });

  test('passes camera options through', async () => {
    const { getUserMedia } = stubGetUserMedia();
    const s = make({
      video: fakeVideo(),
      detector: queuedDetector([]),
      camera: { facingMode: 'user', width: 640, height: 480 },
    });
    await s.start();
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: false,
      video: { facingMode: { ideal: 'user' }, width: { ideal: 640 }, height: { ideal: 480 } },
    });
  });

  test.each([
    ['NotAllowedError', 'permission-denied'],
    ['SecurityError', 'permission-denied'],
    ['NotFoundError', 'no-camera'],
    ['OverconstrainedError', 'no-camera'],
    ['NotReadableError', 'camera-in-use'],
    ['TypeError', 'unsupported'],
  ])('maps %s to %s', async (name, code) => {
    stubGetUserMedia(async () => {
      throw new DOMException('nope', name);
    });
    const s = make({ video: fakeVideo(), detector: queuedDetector([]) });
    const onError = vi.fn();
    s.on('error', onError);
    const states = recordStates(s);

    await s.start();

    expect(s.state).toBe('error');
    expect(states).toEqual(['starting', 'error']);
    expect(onError).toHaveBeenCalledTimes(1);
    const err = onError.mock.calls[0][0] as ScannerError;
    expect(err).toBeInstanceOf(ScannerError);
    expect(err.code).toBe(code);
    expect(err.message).toBe(code); // codes, not English
  });

  test('insecure context fails without touching the camera', async () => {
    const { getUserMedia } = stubGetUserMedia();
    setSecureContext(false);
    const s = make({ video: fakeVideo(), detector: queuedDetector([]) });
    const onError = vi.fn();
    s.on('error', onError);
    await s.start();
    expect(onError.mock.calls[0][0].code).toBe('insecure-context');
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(s.state).toBe('error');
  });

  test('missing getUserMedia → unsupported', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true });
    const s = make({ video: fakeVideo(), detector: queuedDetector([]) });
    const onError = vi.fn();
    s.on('error', onError);
    await s.start();
    expect(onError.mock.calls[0][0].code).toBe('unsupported');
  });

  test('stop() during start() cancels the stale start', async () => {
    const pending = deferred<MediaStream>();
    stubGetUserMedia(() => pending.promise);
    const video = fakeVideo();
    const s = make({ video, detector: queuedDetector([]) });
    const states = recordStates(s);

    const started = s.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(s.state).toBe('starting');
    s.stop();

    const stop = vi.fn();
    pending.resolve({ getTracks: () => [{ stop }], getVideoTracks: () => [] } as unknown as MediaStream);
    await started;

    expect(stop).toHaveBeenCalled(); // late stream released immediately
    expect(video.srcObject).toBeNull();
    expect(video.play).not.toHaveBeenCalled();
    expect(s.state).toBe('idle');
    expect(states).toEqual(['starting', 'idle']);
  });

  test('concurrent start() calls share one camera request', async () => {
    const { getUserMedia } = stubGetUserMedia();
    const s = make({ video: fakeVideo(), detector: queuedDetector([]) });
    await Promise.all([s.start(), s.start(), s.start()]);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    await s.start(); // already scanning
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });

  test('can restart after stop()', async () => {
    const { getUserMedia, streams } = stubGetUserMedia();
    const s = make({ video: fakeVideo(), detector: queuedDetector([]) });
    await s.start();
    s.stop();
    expect(streams[0].track.stop).toHaveBeenCalled();
    await s.start();
    expect(s.state).toBe('scanning');
    expect(getUserMedia).toHaveBeenCalledTimes(2);
  });
});

describe('detection loop', () => {
  test('not-found keeps scanning', async () => {
    stubGetUserMedia();
    const other = '4006381333931';
    const detector = queuedDetector([EAN, EAN, null, other, other], 'ean_13', null);
    const lookup = notFound();
    const s = make({ video: fakeVideo(), detector, lookup });
    const onNotFound = vi.fn();
    s.on('not-found', onNotFound);

    await s.start();
    await vi.advanceTimersByTimeAsync(1000);

    expect(lookup).toHaveBeenCalledTimes(2);
    expect(onNotFound).toHaveBeenNthCalledWith(1, { code: { value: EAN, format: 'ean_13' } });
    expect(onNotFound).toHaveBeenNthCalledWith(2, { code: { value: other, format: 'ean_13' } });
    expect(s.state).toBe('scanning');
  });

  test('one confirmed read per uninterrupted sighting', async () => {
    stubGetUserMedia();
    const detector = queuedDetector([], 'ean_13', EAN); // code stays in view
    const s = make({ video: fakeVideo(), detector });
    const onDetect = vi.fn();
    s.on('detect', onDetect);
    await s.start();
    await vi.advanceTimersByTimeAsync(3000);
    expect(onDetect).toHaveBeenCalledTimes(1);
    expect(s.state).toBe('scanning'); // scan-only continuous keeps going
  });

  test('skips detection while a lookup is in flight', async () => {
    stubGetUserMedia();
    const pending = deferred<{ found: false }>();
    const detector = queuedDetector([], 'ean_13', EAN);
    const lookup = vi.fn<LookupFn>(() => pending.promise);
    const s = make({ video: fakeVideo(), detector, lookup });

    await s.start();
    await vi.advanceTimersByTimeAsync(200);
    expect(s.state).toBe('looking-up');
    const calls = detector.detect.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1000);
    expect(detector.detect.mock.calls.length).toBe(calls);

    pending.resolve({ found: false });
    await vi.advanceTimersByTimeAsync(200);
    expect(s.state).toBe('scanning');
    expect(detector.detect.mock.calls.length).toBeGreaterThan(calls);
  });

  test('stop() aborts an in-flight lookup', async () => {
    stubGetUserMedia();
    let signal!: AbortSignal;
    const lookup = vi.fn<LookupFn>((_v, ctx) => {
      signal = ctx.signal;
      return new Promise(() => {});
    });
    const s = make({ video: fakeVideo(), detector: queuedDetector([EAN, EAN]), lookup });
    const onProduct = vi.fn();
    s.on('product', onProduct);
    await s.start();
    await vi.advanceTimersByTimeAsync(200);
    expect(s.state).toBe('looking-up');
    s.stop();
    expect(signal.aborted).toBe(true);
    expect(s.state).toBe('idle');
  });

  test('lookup failure emits lookup-failed and keeps scanning', async () => {
    stubGetUserMedia();
    const lookup = vi.fn<LookupFn>(async () => {
      throw new Error('500');
    });
    const s = make({ video: fakeVideo(), detector: queuedDetector([EAN, EAN]), lookup });
    const onError = vi.fn();
    s.on('error', onError);
    await s.start();
    await vi.advanceTimersByTimeAsync(300);
    expect(onError.mock.calls[0][0].code).toBe('lookup-failed');
    expect(s.state).toBe('scanning');
  });

  test('ScannerError codes from the lookup are preserved (rate-limited)', async () => {
    stubGetUserMedia();
    const lookup = vi.fn<LookupFn>(async () => {
      throw new ScannerError('rate-limited');
    });
    const s = make({ video: fakeVideo(), detector: queuedDetector([EAN, EAN]), lookup });
    const onError = vi.fn();
    s.on('error', onError);
    await s.start();
    await vi.advanceTimersByTimeAsync(300);
    expect(onError.mock.calls[0][0].code).toBe('rate-limited');
  });

  test('rejects EAN with a bad checksum before confirmation', async () => {
    stubGetUserMedia();
    const s = make({ video: fakeVideo(), detector: queuedDetector([], 'ean_13', '5012345678901') });
    const onDetect = vi.fn();
    s.on('detect', onDetect);
    await s.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(onDetect).not.toHaveBeenCalled();
  });

  test('custom filter and formats', async () => {
    stubGetUserMedia();
    const s = make({
      video: fakeVideo(),
      detector: queuedDetector([], 'qr_code', 'https://example.com'),
      formats: ['qr_code'],
      filter: (c) => c.value.startsWith('https://'),
    });
    const onDetect = vi.fn();
    s.on('detect', onDetect);
    await s.start();
    await vi.advanceTimersByTimeAsync(500);
    expect(onDetect).toHaveBeenCalledWith({ value: 'https://example.com', format: 'qr_code' });
  });

  test('picks the first valid hit in a frame', async () => {
    stubGetUserMedia();
    const detector = {
      detect: vi.fn(async () => [
        { rawValue: '5012345678901', format: 'ean_13' }, // bad checksum
        { rawValue: ` ${EAN} `, format: 'ean_13' },
      ]),
    };
    const s = make({ video: fakeVideo(), detector });
    const onDetect = vi.fn();
    s.on('detect', onDetect);
    await s.start();
    await vi.advanceTimersByTimeAsync(500);
    expect(onDetect).toHaveBeenCalledWith({ value: EAN, format: 'ean_13' });
  });

  test('single mode pauses after the first confirmed read (scan-only)', async () => {
    const { streams } = stubGetUserMedia();
    const s = make({ video: fakeVideo(), detector: queuedDetector([EAN, EAN]), mode: 'single' });
    const onDetect = vi.fn();
    s.on('detect', onDetect);
    await s.start();
    await vi.advanceTimersByTimeAsync(500);
    expect(onDetect).toHaveBeenCalledTimes(1);
    expect(s.state).toBe('paused');
    expect(streams[0].track.stop).toHaveBeenCalled();
  });

  test('single mode also pauses on not-found', async () => {
    stubGetUserMedia();
    const s = make({ video: fakeVideo(), detector: queuedDetector([EAN, EAN]), mode: 'single', lookup: notFound() });
    await s.start();
    await vi.advanceTimersByTimeAsync(500);
    expect(s.state).toBe('paused');
  });

  test('vibrates on a confirmed read unless disabled', async () => {
    stubGetUserMedia();
    const vibrate = vi.fn(() => true);
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });
    const s = make({ video: fakeVideo(), detector: queuedDetector([EAN, EAN]) });
    await s.start();
    await vi.advanceTimersByTimeAsync(500);
    expect(vibrate).toHaveBeenCalledWith(35);

    vibrate.mockClear();
    const quiet = make({ video: fakeVideo(), detector: queuedDetector([EAN, EAN]), vibrate: false });
    await quiet.start();
    await vi.advanceTimersByTimeAsync(500);
    expect(vibrate).not.toHaveBeenCalled();
  });

  test('waits for video data (readyState >= 2)', async () => {
    stubGetUserMedia();
    const video = fakeVideo({ readyState: 1 });
    const detector = queuedDetector([]);
    const s = make({ video, detector });
    await s.start();
    await vi.advanceTimersByTimeAsync(300);
    expect(detector.detect).not.toHaveBeenCalled();
    (video as any).readyState = 4;
    await vi.advanceTimersByTimeAsync(300);
    expect(detector.detect).toHaveBeenCalled();
  });

  test('throttles detection to maxFps', async () => {
    stubGetUserMedia();
    const detector = queuedDetector([]);
    const s = make({ video: fakeVideo(), detector, maxFps: 5 });
    await s.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(detector.detect.mock.calls.length).toBeGreaterThanOrEqual(4);
    expect(detector.detect.mock.calls.length).toBeLessThanOrEqual(6);
  });

  test('falls back to requestAnimationFrame without requestVideoFrameCallback', async () => {
    stubGetUserMedia();
    const raf = vi.fn((cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 16) as unknown as number);
    vi.stubGlobal('requestAnimationFrame', raf);
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
    const detector = queuedDetector([EAN, EAN]);
    const s = make({
      video: fakeVideo({ requestVideoFrameCallback: undefined, cancelVideoFrameCallback: undefined }),
      detector,
    });
    const onDetect = vi.fn();
    s.on('detect', onDetect);
    await s.start();
    await vi.advanceTimersByTimeAsync(500);
    expect(raf).toHaveBeenCalled();
    expect(onDetect).toHaveBeenCalledTimes(1);
  });
});

describe('page lifecycle', () => {
  test('pauses when the tab is hidden', async () => {
    const { streams } = stubGetUserMedia();
    const s = make({ video: fakeVideo(), detector: queuedDetector([]) });
    await s.start();
    setHidden(true);
    expect(s.state).toBe('paused');
    expect(streams[0].track.stop).toHaveBeenCalled();
  });

  test('pauseWhenHidden: false keeps scanning', async () => {
    stubGetUserMedia();
    const s = make({ video: fakeVideo(), detector: queuedDetector([]), pauseWhenHidden: false });
    await s.start();
    setHidden(true);
    expect(s.state).toBe('scanning');
  });

  test('stops on pagehide', async () => {
    stubGetUserMedia();
    const s = make({ video: fakeVideo(), detector: queuedDetector([]) });
    await s.start();
    window.dispatchEvent(new Event('pagehide'));
    expect(s.state).toBe('idle');
  });

  test('destroy() releases everything and ignores later calls', async () => {
    const { streams, getUserMedia } = stubGetUserMedia();
    const s = make({ video: fakeVideo(), detector: queuedDetector([]) });
    const onState = vi.fn();
    s.on('state', onState);
    await s.start();
    s.destroy();
    expect(streams[0].track.stop).toHaveBeenCalled();
    onState.mockClear();
    await s.start();
    setHidden(true);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(onState).not.toHaveBeenCalled();
  });
});

describe('manual lookup', () => {
  test('emits detect (manual) and the product, without the camera', async () => {
    const { getUserMedia } = stubGetUserMedia();
    const lookup = found('Boot');
    const s = make({ video: fakeVideo(), detector: queuedDetector([]), lookup });
    const onDetect = vi.fn();
    const onProduct = vi.fn();
    s.on('detect', onDetect);
    s.on('product', onProduct);
    const states = recordStates(s);

    const result = await s.lookup(`  ${EAN} `);

    expect(result).toEqual({ found: true, product: { barcode: EAN, name: 'Boot' } });
    expect(onDetect).toHaveBeenCalledWith({ value: EAN, format: 'manual' });
    expect(onProduct).toHaveBeenCalledWith({
      code: { value: EAN, format: 'manual' },
      product: { barcode: EAN, name: 'Boot' },
    });
    expect(states).toEqual(['looking-up', 'idle']);
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  test('stops a live camera first', async () => {
    const { streams } = stubGetUserMedia();
    const s = make({ video: fakeVideo(), detector: queuedDetector([]), lookup: notFound() });
    const onNotFound = vi.fn();
    s.on('not-found', onNotFound);
    await s.start();
    const result = await s.lookup(EAN);
    expect(result).toEqual({ found: false });
    expect(streams[0].track.stop).toHaveBeenCalled();
    expect(onNotFound).toHaveBeenCalledWith({ code: { value: EAN, format: 'manual' } });
    expect(s.state).toBe('idle');
  });

  test('returns to paused when paused before', async () => {
    stubGetUserMedia();
    const s = make({ video: fakeVideo(), detector: queuedDetector([EAN, EAN]), lookup: found() });
    await s.start();
    await vi.advanceTimersByTimeAsync(500);
    expect(s.state).toBe('paused');
    await s.lookup(EAN);
    expect(s.state).toBe('paused');
  });

  test.each(['', '   ', '<script>', 'x'.repeat(65)])('rejects %j as invalid-input', async (v) => {
    const lookup = found();
    const s = make({ video: fakeVideo(), detector: queuedDetector([]), lookup });
    const onError = vi.fn();
    s.on('error', onError);
    expect(await s.lookup(v)).toBeNull();
    expect(onError.mock.calls[0][0].code).toBe('invalid-input');
    expect(lookup).not.toHaveBeenCalled();
    expect(s.state).toBe('idle');
  });

  test('the filter also applies to manual entry', async () => {
    const s = make({ video: fakeVideo(), detector: queuedDetector([]), lookup: found(), filter: (c) => /^\d{8,15}$/.test(c.value) });
    const onError = vi.fn();
    s.on('error', onError);
    expect(await s.lookup('ABC')).toBeNull();
    expect(onError.mock.calls[0][0].code).toBe('invalid-input');
  });

  test('scan-only mode emits detect and resolves null', async () => {
    const s = make({ video: fakeVideo(), detector: queuedDetector([]) });
    const onDetect = vi.fn();
    s.on('detect', onDetect);
    expect(await s.lookup(EAN)).toBeNull();
    expect(onDetect).toHaveBeenCalledWith({ value: EAN, format: 'manual' });
    expect(s.state).toBe('idle');
  });

  test('a newer manual lookup cancels the older one', async () => {
    const first = deferred<any>();
    let call = 0;
    const lookup = vi.fn<LookupFn>(async (barcode) => {
      if (call++ === 0) return first.promise;
      return { found: true, product: { barcode, name: 'second' } };
    });
    const s = make({ video: fakeVideo(), detector: queuedDetector([]), lookup });
    const onProduct = vi.fn();
    s.on('product', onProduct);
    const a = s.lookup(EAN);
    const b = await s.lookup('4006381333931');
    first.resolve({ found: true, product: { barcode: EAN, name: 'first' } });
    expect(await a).toBeNull();
    expect(b).toEqual({ found: true, product: { barcode: '4006381333931', name: 'second' } });
    expect(onProduct).toHaveBeenCalledTimes(1);
  });
});

describe('detectors', () => {
  test("'auto' uses native BarcodeDetector when it supports every format", async () => {
    stubGetUserMedia();
    const detect = vi.fn(async () => [{ rawValue: EAN, format: 'ean_13' }]);
    const ctor = vi.fn();
    vi.stubGlobal(
      'BarcodeDetector',
      class {
        static getSupportedFormats = async () => ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code'];
        constructor(opts: unknown) {
          ctor(opts);
        }
        detect = detect;
      },
    );
    const s = make({ video: fakeVideo() });
    const onDetect = vi.fn();
    s.on('detect', onDetect);
    await s.start();
    await vi.advanceTimersByTimeAsync(500);
    expect(ctor).toHaveBeenCalledWith({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39'] });
    expect(onDetect).toHaveBeenCalledWith({ value: EAN, format: 'ean_13' });
  });

  test("'native' without BarcodeDetector → detector-failed, and retries on the next start()", async () => {
    const { getUserMedia } = stubGetUserMedia();
    const s = make({ video: fakeVideo(), detector: 'native' });
    const onError = vi.fn();
    s.on('error', onError);
    await s.start();
    expect(onError.mock.calls[0][0].code).toBe('detector-failed');
    expect(getUserMedia).not.toHaveBeenCalled();

    vi.stubGlobal(
      'BarcodeDetector',
      class {
        static getSupportedFormats = async () => ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39'];
        detect = async () => [];
      },
    );
    await s.start();
    expect(s.state).toBe('scanning');
  });

  test("'native' fails when a format is unsupported (all-or-nothing)", async () => {
    stubGetUserMedia();
    vi.stubGlobal(
      'BarcodeDetector',
      class {
        static getSupportedFormats = async () => ['qr_code'];
        detect = async () => [];
      },
    );
    const s = make({ video: fakeVideo(), detector: 'native' });
    const onError = vi.fn();
    s.on('error', onError);
    await s.start();
    expect(onError.mock.calls[0][0].code).toBe('detector-failed');
  });
});

describe('torch & cameras', () => {
  test('setTorch resolves false when not running or unsupported', async () => {
    stubGetUserMedia();
    const s = make({ video: fakeVideo(), detector: queuedDetector([]) });
    expect(await s.setTorch(true)).toBe(false);
    await s.start();
    expect(await s.setTorch(true)).toBe(false);
  });

  test('setTorch applies the torch constraint when supported', async () => {
    const { streams } = stubGetUserMedia(undefined, { torch: true });
    const s = make({ video: fakeVideo(), detector: queuedDetector([]) });
    await s.start();
    expect(await s.setTorch(true)).toBe(true);
    expect(streams[0].track.applyConstraints).toHaveBeenCalledWith({ advanced: [{ torch: true }] });
  });

  test('listCameras returns only video inputs', async () => {
    stubGetUserMedia(undefined, {
      devices: [
        { kind: 'videoinput', deviceId: 'a', label: 'Back' },
        { kind: 'audioinput', deviceId: 'b', label: 'Mic' },
      ],
    });
    const s = make({ video: fakeVideo(), detector: queuedDetector([]) });
    expect((await s.listCameras()).map((d) => d.deviceId)).toEqual(['a']);
  });

  test('switchCamera restarts a live camera with the exact deviceId', async () => {
    const { getUserMedia, streams } = stubGetUserMedia();
    const s = make({ video: fakeVideo(), detector: queuedDetector([]) });
    const states = recordStates(s);
    await s.start();
    await s.switchCamera('cam-2');
    expect(streams[0].track.stop).toHaveBeenCalled();
    expect(getUserMedia).toHaveBeenLastCalledWith({
      audio: false,
      video: { deviceId: { exact: 'cam-2' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    });
    expect(s.state).toBe('scanning');
    expect(states).toEqual(['starting', 'scanning', 'starting', 'scanning']);
  });

  test('switchCamera while idle only stores the choice', async () => {
    const { getUserMedia } = stubGetUserMedia();
    const s = make({ video: fakeVideo(), detector: queuedDetector([]) });
    await s.switchCamera('cam-2');
    expect(getUserMedia).not.toHaveBeenCalled();
    await s.start();
    expect(getUserMedia.mock.calls[0][0]).toMatchObject({ video: { deviceId: { exact: 'cam-2' } } });
  });
});

describe('events', () => {
  test('on() returns an unsubscribe function and listener errors are isolated', async () => {
    stubGetUserMedia();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const s = make({ video: fakeVideo(), detector: queuedDetector([]) });
    const a = vi.fn(() => {
      throw new Error('boom');
    });
    const b = vi.fn();
    const off = s.on('state', b);
    s.on('state', a);
    await s.start();
    expect(a).toHaveBeenCalled();
    expect(b).toHaveBeenCalledWith('scanning');
    expect(errorSpy).toHaveBeenCalled();
    off();
    b.mockClear();
    s.stop();
    expect(b).not.toHaveBeenCalled();
  });

  test('state settles before outcome events are emitted', async () => {
    stubGetUserMedia();
    const log: string[] = [];
    const s = make({ video: fakeVideo(), detector: queuedDetector([EAN, EAN]), lookup: notFound() });
    s.on('state', (st) => log.push(`state:${st}`));
    s.on('not-found', () => log.push(`not-found (state=${s.state})`));
    await s.start();
    await vi.advanceTimersByTimeAsync(500);
    expect(log).toEqual(['state:starting', 'state:scanning', 'state:looking-up', 'state:scanning', 'not-found (state=scanning)']);

    const log2: string[] = [];
    const t = make({ video: fakeVideo(), detector: queuedDetector([EAN, EAN]), lookup: found() });
    t.on('product', () => log2.push(`product (state=${t.state})`));
    await t.start();
    await vi.advanceTimersByTimeAsync(500);
    expect(log2).toEqual(['product (state=paused)']);
  });

  test('a product listener may stop the scanner without it being overridden', async () => {
    stubGetUserMedia();
    const s = make({ video: fakeVideo(), detector: queuedDetector([EAN, EAN]), lookup: found() });
    s.on('product', () => s.stop());
    await s.start();
    await vi.advanceTimersByTimeAsync(500);
    expect(s.state).toBe('idle');
  });
});
