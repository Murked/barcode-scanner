import { expect, test } from '@playwright/test';
import { canCapture, installCanvasCamera } from './canvas-camera';

// Runs in Chromium, Firefox and WebKit (Safari's engine) with a canvas-backed fake camera
// and the real decoder (native BarcodeDetector where available, otherwise zxing-wasm).
// Camera tests skip on engine builds without media capture (Playwright's WebKit on Windows).
const EAN = '5012345678900';
const WASM = '/node_modules/zxing-wasm/dist/reader/zxing_reader.wasm';

test.beforeEach(async ({ page }) => {
  await installCanvasCamera(page, EAN);
});

test('zxing-wasm decodes an EAN-13 in this engine', async ({ page }) => {
  await page.goto('/examples/web-component/');
  const result = await page.evaluate(async (wasm) => {
    const { BarcodeDetector, prepareZXingModule } = await import('barcode-detector/ponyfill' as string);
    await prepareZXingModule({
      fireImmediately: true,
      overrides: { locateFile: (p: string, prefix: string) => (p.endsWith('.wasm') ? wasm : prefix + p) },
    });
    const canvas = document.createElement('canvas');
    (window as any).__drawBarcode(canvas);
    const hits = await new BarcodeDetector({ formats: ['ean_13'] }).detect(canvas);
    return hits.map((h: { rawValue: string; format: string }) => `${h.format}:${h.rawValue}`);
  }, WASM);
  expect(result).toEqual([`ean_13:${EAN}`]);
});

test('web component: scan → lookup → result', async ({ page }) => {
  await page.goto('/examples/web-component/');
  test.skip(!(await canCapture(page)), 'no media capture in this browser build');
  await page.getByRole('button', { name: 'Start camera' }).click();
  await expect(page.locator('barcode-scanner [part="product-name"]')).toHaveText('Demo Runner', { timeout: 15_000 });
  await expect(page.locator('#log')).toContainText(`detect    ${EAN} (ean_13)`);
  await expect(page.locator('barcode-scanner')).toHaveAttribute('state', 'paused');
  // Camera released after the match.
  const src = await page.locator('barcode-scanner').evaluate(
    (el) => (el.shadowRoot!.querySelector('video') as HTMLVideoElement).srcObject,
  );
  expect(src).toBeNull();
});

test('without camera support: friendly error, manual entry still works', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'mediaDevices', { get: () => undefined, configurable: true });
  });
  await page.goto('/examples/web-component/');
  await page.getByRole('button', { name: 'Start camera' }).click();
  await expect(page.getByRole('status')).toHaveText('This browser cannot access a camera. Enter a barcode instead.');
  await expect(page.locator('barcode-scanner')).toHaveAttribute('state', 'error');

  await page.getByRole('textbox', { name: 'Barcode number' }).fill(EAN);
  await page.getByRole('button', { name: 'Look up' }).click();
  await expect(page.locator('barcode-scanner [part="product-name"]')).toHaveText('Demo Runner');
});

test('web component: manual miss message', async ({ page }) => {
  await page.goto('/examples/web-component/');
  await page.getByRole('textbox', { name: 'Barcode number' }).fill('4006381333931');
  await page.getByRole('button', { name: 'Look up' }).click();
  await expect(page.getByRole('status')).toHaveText(
    'No product found for 4006381333931. Keep scanning or try another barcode.',
  );
});

test('themed example: ::part() and slotted result', async ({ page }) => {
  await page.goto('/examples/web-component-styled/');
  const radius = await page
    .locator('barcode-scanner [part="viewfinder"]')
    .evaluate((el) => getComputedStyle(el).borderTopLeftRadius);
  expect(radius).toBe('20px');
  test.skip(!(await canCapture(page)), 'no media capture in this browser build');
  await page.getByRole('button', { name: 'Scan', exact: true }).click();
  await expect(page.locator('#p-name')).toHaveText('Demo Runner', { timeout: 15_000 });
});
