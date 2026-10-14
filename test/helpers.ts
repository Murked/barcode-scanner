import { vi } from 'vitest';

export interface FakeVideo extends HTMLVideoElement {
  play: ReturnType<typeof vi.fn> & HTMLVideoElement['play'];
}

/** Minimal `<video>` stand-in: readyState 4 and a timer-driven requestVideoFrameCallback (~30 fps). */
export function fakeVideo(overrides: Partial<Record<string, unknown>> = {}): FakeVideo {
  const v = {
    srcObject: null as MediaStream | null,
    muted: false,
    playsInline: false,
    readyState: 4,
    setAttribute: vi.fn(),
    play: vi.fn(async () => {}),
    requestVideoFrameCallback(cb: (now: number) => void) {
      return setTimeout(() => cb(Date.now()), 33) as unknown as number;
    },
    cancelVideoFrameCallback(id: number) {
      clearTimeout(id);
    },
    ...overrides,
  };
  return v as unknown as FakeVideo;
}

export interface FakeTrack {
  stop: ReturnType<typeof vi.fn>;
  getCapabilities: () => Record<string, unknown>;
  applyConstraints: ReturnType<typeof vi.fn>;
}

export function fakeStream({ torch = false } = {}) {
  const track: FakeTrack = {
    stop: vi.fn(),
    getCapabilities: () => (torch ? { torch: true } : {}),
    applyConstraints: vi.fn(async () => {}),
  };
  return {
    track,
    stream: {
      getTracks: () => [track],
      getVideoTracks: () => [track],
    } as unknown as MediaStream,
  };
}

/**
 * Install a fake `navigator.mediaDevices`. By default every call resolves a new
 * fake stream; pass `impl` to control it (e.g. reject with a DOMException).
 */
export function stubGetUserMedia(
  impl?: (constraints: MediaStreamConstraints) => Promise<MediaStream>,
  { torch = false, devices = [] as Partial<MediaDeviceInfo>[] } = {},
) {
  const streams: ReturnType<typeof fakeStream>[] = [];
  const getUserMedia = vi.fn(
    impl ??
      (async () => {
        const s = fakeStream({ torch });
        streams.push(s);
        return s.stream;
      }),
  );
  const enumerateDevices = vi.fn(async () => devices as MediaDeviceInfo[]);
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia, enumerateDevices },
    configurable: true,
    writable: true,
  });
  return { getUserMedia, enumerateDevices, streams };
}

export function setSecureContext(value: boolean) {
  Object.defineProperty(window, 'isSecureContext', { value, configurable: true, writable: true });
}

export function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { value: hidden, configurable: true });
  Object.defineProperty(document, 'visibilityState', {
    value: hidden ? 'hidden' : 'visible',
    configurable: true,
  });
  document.dispatchEvent(new Event('visibilitychange'));
}

/** Detector that returns the queued reads in order, then `rest` forever. */
export function queuedDetector(reads: (string | null)[], format = 'ean_13', rest: string | null = null) {
  return {
    detect: vi.fn(async () => {
      const next = reads.length ? reads.shift()! : rest;
      return next ? [{ rawValue: next, format }] : [];
    }),
  };
}

export function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export const EAN = '5012345678900'; // valid EAN-13 checksum

/**
 * Make real (happy-dom) <video> elements usable by the core: resolved play(),
 * readyState 4, timer-driven requestVideoFrameCallback, and a srcObject that
 * accepts our fake streams.
 */
export function stubVideoElement() {
  const proto = HTMLMediaElement.prototype as any;
  vi.spyOn(proto, 'play').mockImplementation(async () => {});
  Object.defineProperty(proto, 'readyState', { get: () => 4, configurable: true });
  Object.defineProperty(proto, 'srcObject', {
    get() {
      return this.__src ?? null;
    },
    set(v) {
      this.__src = v;
    },
    configurable: true,
  });
  proto.requestVideoFrameCallback = (cb: (n: number) => void) => setTimeout(() => cb(Date.now()), 33);
  proto.cancelVideoFrameCallback = (id: number) => clearTimeout(id);
}
