# Lookup proxies

Until publishable keys exist, keep API secrets on your server and point the scanner
at your own endpoint:

```js
import { urlLookup } from '@yourbrand/scanner';
createScanner({ video, lookup: urlLookup('/api/lookup/{barcode}') });
// or: <barcode-scanner lookup-url="/api/lookup/{barcode}">
```

| File | Stack |
|---|---|
| `express.mjs` | Node + Express (`npm i express`, `BARCODES_API_KEY=… node express.mjs`) |
| `laravel-route.php` | Laravel route with `throttle:30,1` |

## Response contract (what `urlLookup` understands)

| Response | Result |
|---|---|
| `200 { "found": true, "product": { … } }` | `product` event |
| `200 { …product }` (bare object) | `product` event |
| `200 { "found": false }` or `404` | `not-found` event |
| `429` | `error` with code `rate-limited` |
| any other non-2xx, network error, invalid JSON | `error` with code `lookup-failed` |

Endpoints that return a different shape can be adapted without changing the server:

```js
urlLookup('/lookup/{barcode}', {
  mapProduct: (d) => ({ barcode: d.barcode, name: d.name, imageUrl: d.image_url, pageUrl: d.page_url, raw: d }),
});
```

API URLs and upstream field names in these examples are placeholders — align them
with the real Barcodes API.
