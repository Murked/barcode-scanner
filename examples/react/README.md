# React example

Uses `useBarcodeScanner()` with fully custom JSX.

```sh
# from the repo root
npm run build
cd examples/react
npm install
npm run dev
```

The demo calls `/api/lookup/{barcode}`, which Vite proxies to `http://localhost:4173`.
Run `npm run serve` in the repo root for the demo endpoint (it knows `5012345678900`), or
point the proxy at your own backend (see `../proxy-server`), or swap `urlLookup(...)` for
your own `lookup` function.
