import { expect, test } from '@playwright/test';

// DESIGN.md §9: barcodes-new's scanner rebuilt on the library is the API acceptance test.
// Runs examples/dogfood-barcodes-new/barcode-scanner.js against the site's markup and a
// mock of ScannerController's flat JSON payload.
const EAN = '5012345678900';

test('camera scan opens the result dialog and pauses the camera', async ({ page }) => {
  await page.goto('/test/e2e/dogfood/');
  await page.getByRole('button', { name: 'Start camera' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('[data-value]')).toHaveText(EAN);
  await expect(dialog.locator('[data-name]')).toHaveText('Demo Runner');
  await expect(dialog.locator('[data-details]')).toHaveText('Acme\nAC-100\n3 barcodes found');
  await expect(dialog.locator('[data-page-link]')).toHaveAttribute('href', 'https://example.com/products/demo-runner');
  await expect(page.locator('[data-status]')).toHaveText('Camera paused while you review the result.');
  await expect(page.getByRole('button', { name: 'Start camera' })).toBeVisible();

  await page.getByRole('button', { name: 'Scan again' }).click();
  await expect(dialog).toBeVisible(); // re-reads the same code after restarting
  await expect(page.locator('[data-status]')).toHaveText('Camera paused while you review the result.');
});

test('manual entry: miss, then hit, in the inline panel', async ({ page }) => {
  await page.goto('/test/e2e/dogfood/');
  const input = page.getByLabel('UPC or EAN barcode digits');

  await input.fill('4006381333931');
  await page.getByRole('button', { name: 'Look up' }).click();
  await expect(page.locator('[data-manual-feedback]')).toHaveText(
    'No product found for 4006381333931. Check the digits and try another barcode.',
  );

  await input.fill(EAN);
  await page.getByRole('button', { name: 'Look up' }).click();
  await expect(page.locator('[data-manual-result]')).toBeVisible();
  await expect(page.locator('[data-manual-name]')).toHaveText('Demo Runner');
  await expect(page.locator('[data-manual-feedback]')).toBeHidden();
  await expect(page.getByRole('dialog')).toBeHidden();
});

test('stop during a lookup, and pausing when the tab is hidden', async ({ page }) => {
  await page.route('**/api/flat-lookup/**', () => {}); // never answers: hold the lookup in flight
  await page.goto('/test/e2e/dogfood/');
  const status = page.locator('[data-status]');

  await page.getByRole('button', { name: 'Start camera' }).click();
  await expect(status).toHaveText(`Looking up ${EAN}… Keep the barcode in view.`);
  await page.getByRole('button', { name: 'Stop camera' }).click();
  await expect(status).toHaveText('Camera off. Start it again or enter a barcode below.');

  await page.getByRole('button', { name: 'Start camera' }).click();
  await expect(status).toHaveText(`Looking up ${EAN}… Keep the barcode in view.`);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(status).toHaveText('Camera paused when you left this tab. Start it again to scan.');
  expect(await page.evaluate(() => (document.querySelector('[data-preview]') as HTMLVideoElement).srcObject)).toBeNull();
});
