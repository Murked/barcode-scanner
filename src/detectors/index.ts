import type { BarcodeFormat, Detector, DetectorPreference } from '../types';
import { tryNative } from './native';

/** Resolve a detector: injected → native `BarcodeDetector` → zxing-wasm (lazy chunk). */
export async function loadDetector(
  pref: DetectorPreference,
  formats: BarcodeFormat[],
  wasmUrl?: string,
): Promise<Detector> {
  if (typeof pref === 'object') return pref; // injected (tests / custom engines)
  if (pref !== 'zxing') {
    const native = await tryNative(formats);
    if (native) return native;
    if (pref === 'native') throw new Error('Native BarcodeDetector unavailable for the requested formats');
  }
  const { createZxingDetector } = await import('./zxing'); // separate lazy chunk
  return createZxingDetector(formats, wasmUrl);
}
