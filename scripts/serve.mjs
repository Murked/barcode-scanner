#!/usr/bin/env node
// Zero-dependency dev server for the examples and the E2E suite.
//  - serves the repo root statically (examples/, dist/, node_modules/)
//  - GET /api/lookup/:barcode → demo lookup endpoint ({ found, product })
//
//   npm run build && npm run serve   →   http://localhost:4173/examples/
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT ?? 4173);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

/** Demo catalogue — stands in for your backend proxy (see examples/proxy-server). */
const PRODUCTS = {
  '5012345678900': {
    barcode: '5012345678900',
    name: 'Demo Runner',
    brand: 'Acme',
    styleCode: 'AC-100',
    imageUrl: '/examples/assets/shoe.svg',
    pageUrl: 'https://example.com/products/demo-runner',
  },
};

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

  const lookup = url.pathname.match(/^\/api\/lookup\/([^/]+)$/);
  if (lookup) {
    const product = PRODUCTS[decodeURIComponent(lookup[1])];
    res.writeHead(200, { 'Content-Type': TYPES['.json'], 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify(product ? { found: true, product } : { found: false }));
  }

  // Mirrors barcodes-new ScannerController's flat payload (used by the dogfood E2E).
  const flat = url.pathname.match(/^\/api\/flat-lookup\/([^/]+)$/);
  if (flat) {
    const barcode = decodeURIComponent(flat[1]);
    const p = PRODUCTS[barcode];
    res.writeHead(/^[0-9]{8,15}$/.test(barcode) ? 200 : 422, { 'Content-Type': TYPES['.json'], 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify(p
      ? { found: true, barcode, name: p.name, brand: p.brand, style_code: p.styleCode, sizes_count: 3, image_url: p.imageUrl, page_url: p.pageUrl }
      : { found: false, barcode }));
  }

  let file = normalize(join(root, decodeURIComponent(url.pathname)));
  if (!file.startsWith(root + sep) && file !== root) {
    res.writeHead(403);
    return res.end();
  }
  try {
    if (statSync(file).isDirectory()) file = join(file, 'index.html');
    const size = statSync(file).size;
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Content-Length': size });
    createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
});

server.listen(port, () => console.log(`Serving ${root} on http://localhost:${port}/examples/`));
