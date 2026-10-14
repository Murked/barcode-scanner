import type { BarcodeFormat, Detector } from '../types';

/** Native `window.BarcodeDetector`, only if it supports every requested format. */
export async function tryNative(formats: BarcodeFormat[]): Promise<Detector | null> {
  const BD = (globalThis as { BarcodeDetector?: any }).BarcodeDetector;
  if (!BD?.getSupportedFormats) return null;
  try {
    const supported: string[] = await BD.getSupportedFormats();
    if (!formats.every((f) => supported.includes(f))) return null; // all-or-nothing
    return new BD({ formats }) as Detector;
  } catch {
    return null;
  }
}
