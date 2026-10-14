# Lookup through your own server

If you don't want your Barcodes.gg token in the browser, look products up on your server
and point the scanner at that endpoint:

```js
import { createScanner, urlLookup } from '@barcodesgg/scanner';
createScanner({ video, lookup: urlLookup('/api/lookup/{barcode}') });
```

```html
<barcode-scanner lookup-url="/api/lookup/{barcode}"></barcode-scanner>
```

| File | Stack |
|---|---|
| `express.mjs` | Node + Express + [`@barcodesgg/sdk`](https://github.com/Murked/barcodes-js-sdk) |
| `laravel-route.php` | Laravel route with `throttle:30,1` |

## Response contract (what `urlLookup` understands)

| Response | Result |
|---|---|
| `200 { "found": true, "product": { … } }` | `product` event |
| `200 { …product }` (bare object) | `product` event |
| `200 { "found": false }` or `404` | `not-found` event |
| `429` | `error` with code `rate-limited` |
| any other non-2xx, network error, invalid JSON | `error` with code `lookup-failed` |

`product` should follow the scanner's `Product` shape (`barcode`, `name`, `brand`,
`styleCode`, `imageUrl`, `pageUrl`). Endpoints that return something else can be adapted
in the browser:

```js
urlLookup('/lookup/{barcode}', {
  mapProduct: (d) => ({ barcode: d.barcode, name: d.name, imageUrl: d.image_url, pageUrl: d.page_url, raw: d }),
});
```
