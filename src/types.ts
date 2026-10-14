import type { ScannerError } from './errors';

export type BarcodeFormat =
  | 'ean_13'
  | 'ean_8'
  | 'upc_a'
  | 'upc_e'
  | 'code_128'
  | 'code_39'
  | 'qr_code'
  | 'itf';

export type ScannerState = 'idle' | 'starting' | 'scanning' | 'looking-up' | 'paused' | 'error';

export interface DetectedCode {
  value: string;
  /** `'manual'` = typed in via `scanner.lookup()`, not scanned. */
  format: BarcodeFormat | 'manual';
}

/** Placeholder shape — will mirror the Barcodes API once finalized. */
export interface Product {
  barcode: string;
  name: string;
  brand?: string | null;
  styleCode?: string;
  imageUrl?: string;
  pageUrl?: string;
  /** Full payload for power users. */
  raw?: unknown;
}

export type LookupResult<P = Product> = { found: true; product: P } | { found: false };

export type LookupFn<P = Product> = (
  value: string,
  ctx: { signal: AbortSignal },
) => Promise<LookupResult<P>>;

export interface Detector {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string; format: string }[]>;
}

export type DetectorPreference = 'auto' | 'native' | 'zxing' | Detector;

export interface CameraOptions {
  facingMode?: 'environment' | 'user';
  deviceId?: string;
  width?: number;
  height?: number;
}

export interface ScannerOptions<P = Product> {
  video: HTMLVideoElement;
  /** Default: retail formats (`ean_13, ean_8, upc_a, upc_e, code_128, code_39`). */
  formats?: BarcodeFormat[];
  /** `single` = pause after the first confirmed read. Default `continuous`. */
  mode?: 'single' | 'continuous';
  /** Omit for scan-only mode. */
  lookup?: LookupFn<P>;
  /** Default: GTIN checksum for retail formats, non-empty for everything else. */
  filter?: (code: DetectedCode) => boolean;
  /** Same value must be seen twice within this window to confirm. Default 1800. */
  confirmMs?: number;
  /** Default `'auto'`: native `BarcodeDetector` when it supports every format, else zxing-wasm. */
  detector?: DetectorPreference;
  /** Self-host the zxing wasm (`zxing_reader.wasm`). Default: jsDelivr CDN. */
  wasmUrl?: string;
  camera?: CameraOptions;
  /** Max detection attempts per second. Default 15. */
  maxFps?: number;
  /** Pause (and release the camera) when the tab is hidden. Default true. */
  pauseWhenHidden?: boolean;
  /** `navigator.vibrate(35)` on each confirmed read. Default true. */
  vibrate?: boolean;
}

export interface ScannerEvents<P = Product> {
  state: ScannerState;
  /** Every confirmed read (camera or manual). */
  detect: DetectedCode;
  /** Lookup hit. */
  product: { code: DetectedCode; product: P };
  /** Lookup miss. */
  'not-found': { code: DetectedCode };
  /** Fatal errors also move the scanner to the `error` state; lookup/input errors do not. */
  error: ScannerError;
}

export interface Scanner<P = Product> {
  readonly state: ScannerState;
  start(): Promise<void>;
  /** → idle, camera released. */
  stop(): void;
  /** → paused, camera released. */
  pause(): void;
  /** Manual entry. Resolves `null` when there is no lookup, input is invalid, or it was cancelled. */
  lookup(value: string): Promise<LookupResult<P> | null>;
  /** Resolves `false` if the current camera has no torch. */
  setTorch(on: boolean): Promise<boolean>;
  listCameras(): Promise<MediaDeviceInfo[]>;
  switchCamera(deviceId: string): Promise<void>;
  on<K extends keyof ScannerEvents<P>>(
    event: K,
    fn: (payload: ScannerEvents<P>[K]) => void,
  ): () => void;
  destroy(): void;
}
