# Dogfood: barcodes-new

`barcode-scanner.js` is a drop-in replacement for
`barcodes-new/resources/js/barcode-scanner.js` (DESIGN.md build step 7, which is a
separate change in that repo). It keeps the Blade markup, `<dialog>`, wording and the
`ScannerController` response unchanged.

To adopt it in barcodes-new:

1. `npm install @yourbrand/scanner` (keeps `barcode-detector` / `zxing-wasm` as transitive deps).
2. Replace `resources/js/barcode-scanner.js` with this file.
3. Delete `resources/js/scanner-confirmation.js` and its test (the core owns confirmation).
4. Manual check on iOS Safari + Android Chrome: scan → dialog → "Scan again", manual
   entry hit/miss, tab switch pauses, permission denied message.

What moved into the library: camera start/stop, the generation counter, read
confirmation, in-flight/abort handling, pause-on-match, visibility/pagehide handling,
error mapping, vibration. What stays in the site: wording and the dialog/manual UI.
