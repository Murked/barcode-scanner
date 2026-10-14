# React example

Uses `useBarcodeScanner()` with fully custom JSX.

```sh
# from the repo root
npm run build
cd examples/react
npm install
npm run dev
```

Set `VITE_BARCODES_PUBLISHABLE_KEY=pk_...` (e.g. in `.env.local`) to look products up with the
Barcodes.gg API. Create the key at https://barcodes.gg/dashboard/tokens and add `localhost:5173`
to its allowed domains.
Without it the demo calls `/api/lookup/{barcode}`, which Vite proxies to `http://localhost:4173`.
Run `npm run serve` in the repo root for the demo endpoint (it knows `5012345678900`), or
point the proxy at your own backend (see `../proxy-server`), or swap `urlLookup(...)` for
your own `lookup` function.
