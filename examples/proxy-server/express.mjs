// Lookup proxy for `urlLookup('/api/lookup/{barcode}')` or `<barcode-scanner lookup-url="/api/lookup/{barcode}">`.
// Your Barcodes.gg token stays on the server; the browser only sees a small product preview.
//
//   npm install express @barcodesgg/sdk
//   BARCODES_API_KEY=... node express.mjs
import express from 'express';
import { createSdk } from '@barcodesgg/sdk';

const sdk = createSdk({ apiKey: process.env.BARCODES_API_KEY, throwOnApiError: false });
const app = express();

// Simple in-memory rate limit (30 lookups / minute / IP). Use a real limiter in production.
const hits = new Map();
app.use('/api/lookup', (req, res, next) => {
  const now = Date.now();
  const recent = (hits.get(req.ip) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(req.ip, recent);
  if (recent.length > 30) return res.status(429).json({ message: 'Too many lookups' }); // → 'rate-limited'
  next();
});

app.get('/api/lookup/:barcode', async (req, res) => {
  const { barcode } = req.params;
  if (!/^[0-9]{8,15}$/.test(barcode)) return res.status(422).json({ message: 'Invalid barcode' });
  res.set('Cache-Control', 'no-store');

  try {
    const data = await sdk.barcodes.lookup(barcode, { fields: '*' });
    if (data.error || !data.product) return res.json({ found: false }); // "Barcode could not be found." etc.
    const p = data.product;
    res.json({
      found: true,
      product: {
        barcode,
        name: p.product_name,
        brand: p.product_brand,
        styleCode: p.product_style_code,
        imageUrl: p.product_image,
        pageUrl: `https://barcodes.gg/barcode/${barcode}`,
      },
    });
  } catch {
    res.status(502).json({ message: 'Lookup unavailable' }); // → 'lookup-failed'
  }
});

app.listen(process.env.PORT ?? 3000, () => console.log('Lookup proxy on http://localhost:3000'));
