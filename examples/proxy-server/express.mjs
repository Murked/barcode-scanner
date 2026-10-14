// Lookup proxy for `urlLookup('/api/lookup/{barcode}')`.
// Your server holds the API key; the browser only ever sees a small public preview.
//
//   npm install express
//   BARCODES_API_KEY=sk_... node express.mjs
//
// API URL and response field names are placeholders — align with the real Barcodes API.
import express from 'express';

const app = express();
const API = process.env.BARCODES_API_URL ?? 'https://api.yourbrand.com/v1/barcodes';

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
  if (!/^[0-9]{8,14}$/.test(barcode)) return res.status(422).json({ message: 'Invalid barcode' });

  try {
    const r = await fetch(`${API}/${encodeURIComponent(barcode)}`, {
      headers: { Authorization: `Bearer ${process.env.BARCODES_API_KEY}` },
    });
    res.set('Cache-Control', 'no-store');
    if (r.status === 404) return res.json({ found: false });
    if (!r.ok) return res.status(502).json({ message: 'Upstream error' }); // → 'lookup-failed'
    const p = await r.json();
    res.json({
      found: true,
      product: { barcode: p.barcode, name: p.name, brand: p.brand, imageUrl: p.image, pageUrl: p.url },
    });
  } catch {
    res.status(502).json({ message: 'Upstream unavailable' });
  }
});

app.listen(process.env.PORT ?? 3000, () => console.log('Lookup proxy on http://localhost:3000'));
