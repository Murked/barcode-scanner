import { expect, test } from '@playwright/test';

// Chromium is launched with a fake camera playing test/fixtures/ean13.y4m (EAN-13 5012345678900).
// The real zxing-wasm decoder runs; the wasm is self-hosted by the examples.
const EAN = '5012345678900';

test('web component scans and emits barcode-detect', async ({ page }) => {
  await page.goto('/examples/web-component/');
  const detected = page.evaluate(
    () =>
      new Promise<string>((resolve) =>
        document
          .querySelector('barcode-scanner')!
          .addEventListener('barcode-detect', (e) => resolve((e as CustomEvent).detail.value)),
      ),
  );
  await page.getByRole('button', { name: 'Start camera' }).click();
  expect(await detected).toBe(EAN);

  // Lookup hit → default result rendered, camera paused for review.
  await expect(page.locator('barcode-scanner [part="product-name"]')).toHaveText('Demo Runner');
  await expect(page.locator('barcode-scanner [part="product-meta"]')).toHaveText('Acme · AC-100');
  await expect(page.locator('barcode-scanner')).toHaveAttribute('state', 'paused');
  await expect(page.getByRole('status')).toHaveText('Camera paused.');
  await expect(page.locator('#log')).toContainText(`detect    ${EAN} (ean_13)`);

  // "Scan again" restarts and re-detects the same code (fresh sighting).
  await page.getByRole('button', { name: 'Scan again' }).click();
  await expect(page.locator('barcode-scanner')).toHaveAttribute('state', 'paused', { timeout: 15_000 });
  await expect(page.locator('#log')).toContainText(/product {3}Demo Runner[\s\S]*product {3}Demo Runner/);
});

test('self-hosts the wasm (no CDN)', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  await page.goto('/examples/web-component/');
  await page.getByRole('button', { name: 'Start camera' }).click();
  await expect(page.locator('barcode-scanner')).toHaveAttribute('state', 'paused', { timeout: 15_000 });
  const external = requests.filter((u) => !u.startsWith('http://localhost'));
  expect(external).toEqual([]);
  expect(requests.some((u) => u.endsWith('/zxing_reader.wasm'))).toBe(
    // On platforms with a native BarcodeDetector (macOS, Android) no wasm is needed at all.
    !(await page.evaluate(() => 'BarcodeDetector' in window)),
  );
});

test('manual entry looks up without the camera', async ({ page }) => {
  await page.goto('/examples/web-component/');
  const input = page.getByRole('textbox', { name: 'Barcode number' });

  await input.fill('not a barcode!');
  await page.getByRole('button', { name: 'Look up' }).click();
  await expect(page.getByRole('status')).toHaveText('Enter a valid barcode.');

  await input.fill('4006381333931');
  await page.getByRole('button', { name: 'Look up' }).click();
  await expect(page.getByRole('status')).toHaveText(
    'No product found for 4006381333931. Keep scanning or try another barcode.',
  );

  await input.fill(EAN);
  await page.getByRole('button', { name: 'Look up' }).click();
  await expect(page.locator('barcode-scanner [part="product-name"]')).toHaveText('Demo Runner');
  await expect(page.locator('#log')).toContainText(`detect    ${EAN} (manual)`);
});

test('themed example: messages, slots and parts', async ({ page }) => {
  await page.goto('/examples/web-component-styled/');
  await expect(page.getByRole('button', { name: 'Scan', exact: true })).toBeVisible();
  await expect(page.getByText('Tap “Scan” to start')).toBeVisible();

  // ::part() styling from the page reaches into the shadow DOM.
  const radius = await page
    .locator('barcode-scanner [part="viewfinder"]')
    .evaluate((el) => getComputedStyle(el).borderTopLeftRadius);
  expect(radius).toBe('20px');

  await page.getByRole('button', { name: 'Scan', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Hold the barcode inside the frame.');
  await expect(page.locator('#p-name')).toHaveText('Demo Runner');
  await expect(page.locator('.my-card')).toBeVisible();
  await expect(page.locator('barcode-scanner [part="product-name"]')).toBeHidden(); // default result not used

  await page.getByRole('button', { name: 'Scan another' }).click();
  await expect(page.locator('.my-card')).toBeHidden();
});

test('headless core fills a form field (single mode)', async ({ page }) => {
  await page.goto('/examples/vanilla-headless/');
  await page.getByRole('button', { name: 'Scan SKU' }).click();
  await expect(page.getByLabel('SKU')).toHaveValue(EAN);
  await expect(page.locator('#status')).toHaveText('paused');
  // Camera released after the read.
  expect(await page.evaluate(() => (document.querySelector('#cam') as HTMLVideoElement).srcObject)).toBeNull();
});

test('pauses when the tab is hidden', async ({ page }) => {
  await page.goto('/examples/vanilla-headless/');
  await page.evaluate(async () => {
    const s = (window as any).scanner;
    // Continuous scanning would otherwise keep going; hide before the first read.
    await s.start();
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.locator('#status')).toHaveText('paused');
});

test('token mode: looks up with the Barcodes.gg API', async ({ page }) => {
  const calls: { url: string; auth: string | null }[] = [];
  await page.route('https://barcodes.gg/api/v2/barcode/lookup/**', (route) => {
    calls.push({ url: route.request().url(), auth: route.request().headers()['authorization'] ?? null });
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        error: false,
        barcode: { barcode_type: 'EAN-13', barcode_value: EAN, barcode_added: null, product_size: { us: '9', uk: '8', eu: '42.5' } },
        product: {
          product_name: 'Air Jordan 1 Low',
          product_brand: 'Jordan',
          product_style_code: 'DZ5485-612',
          product_image: 'https://barcodes.gg/api/image/uid/prod_1',
        },
      }),
    });
  });
  await page.route('https://barcodes.gg/api/image/**', (route) => route.abort());

  await page.goto('/examples/web-component/?token=tok_test');
  await page.getByRole('button', { name: 'Start camera' }).click();
  await expect(page.locator('barcode-scanner [part="product-name"]')).toHaveText('Air Jordan 1 Low');
  await expect(page.locator('barcode-scanner [part="product-meta"]')).toHaveText('Jordan · DZ5485-612');
  await expect(page.locator('barcode-scanner [part="product-link"]')).toHaveAttribute('href', `https://barcodes.gg/barcode/${EAN}`);
  expect(calls).toEqual([{ url: `https://barcodes.gg/api/v2/barcode/lookup/${EAN}?fields=*`, auth: 'Bearer tok_test' }]);
});

test('token mode: an invalid token shows a neutral message', async ({ page }) => {
  await page.route('https://barcodes.gg/api/v2/barcode/lookup/**', (route) =>
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: true, message: 'Invalid authorization token.' }),
    }),
  );
  await page.goto('/examples/web-component/?token=bad');
  await page.getByRole('button', { name: 'Start camera' }).click();
  await expect(page.getByRole('status')).toHaveText('Product lookup is not available right now.');
  await expect(page.locator('#log')).toContainText('error     unauthorized');
});
