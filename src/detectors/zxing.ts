import { BarcodeDetector, prepareZXingModule, purgeZXingModule } from 'barcode-detector/ponyfill';
import type { BarcodeFormat, Detector } from '../types';

/**
 * zxing-wasm via `barcode-detector/ponyfill`. The wasm is fetched eagerly so a
 * load failure surfaces as `detector-failed` on `start()` instead of silently
 * failing every frame. Without `wasmUrl` the ponyfill's default (jsDelivr CDN) is used.
 */
export async function createZxingDetector(formats: BarcodeFormat[], wasmUrl?: string): Promise<Detector> {
  try {
    await prepareZXingModule({
      fireImmediately: true,
      ...(wasmUrl && {
        overrides: {
          locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path),
        },
      }),
    });
  } catch (e) {
    purgeZXingModule(); // a rejected load is cached; clear it so a later start() can retry
    throw e;
  }
  return new BarcodeDetector({ formats }) as unknown as Detector;
}
