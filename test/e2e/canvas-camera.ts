import type { Page } from '@playwright/test';

/**
 * Browser-agnostic fake camera. Exposes `window.__drawBarcode(canvas)` everywhere and, where
 * the engine supports media capture, makes getUserMedia return a canvas.captureStream()
 * showing an EAN-13. Unlike Chromium's --use-file-for-fake-video-capture this works in
 * Firefox and (media-enabled) WebKit builds, exercising the real zxing-wasm path.
 */
export async function installCanvasCamera(page: Page, value = '5012345678900') {
  await page.addInitScript((v: string) => {
    const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
    const R = L.map((c) => [...c].map((b) => (b === '0' ? '1' : '0')).join(''));
    const G = R.map((c) => [...c].reverse().join(''));
    const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];
    const d = [...v].map(Number);
    let bits = '101';
    for (let i = 1; i <= 6; i++) bits += (PARITY[d[0]][i - 1] === 'L' ? L : G)[d[i]];
    bits += '01010';
    for (let i = 7; i <= 12; i++) bits += R[d[i]];
    bits += '101';

    const draw = (canvas: HTMLCanvasElement) => {
      canvas.width = 640;
      canvas.height = 480;
      const ctx = canvas.getContext('2d')!;
      const module = 4;
      const x0 = Math.floor((canvas.width - bits.length * module) / 2);
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#000';
      for (let i = 0; i < bits.length; i++) if (bits[i] === '1') ctx.fillRect(x0 + i * module, 120, module, 240);
    };
    (window as any).__drawBarcode = draw;

    const canCapture =
      typeof MediaDevices !== 'undefined' && 'captureStream' in HTMLCanvasElement.prototype;
    (window as any).__canCapture = canCapture;
    if (!canCapture) return; // e.g. Playwright's WebKit on Windows has no media stack

    const fake = async () => {
      const canvas = document.createElement('canvas');
      draw(canvas);
      setInterval(() => draw(canvas), 50); // keep producing frames
      return (canvas as HTMLCanvasElement & { captureStream(fps?: number): MediaStream }).captureStream(30);
    };
    Object.defineProperty(MediaDevices.prototype, 'getUserMedia', { value: fake, configurable: true });
  }, value);
}

export const canCapture = (page: Page) => page.evaluate(() => (window as any).__canCapture as boolean);
