// Drop-in replacement for barcodes-new/resources/js/barcode-scanner.js built on
// @yourbrand/scanner (DESIGN.md §9 — the acceptance test for the API).
// Blade markup, the <dialog> and ScannerController stay exactly as they are.
// scanner-confirmation.js (+ its test) can be deleted: the core owns confirmation.
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';
import { createScanner, defaultFilter, urlLookup } from '@yourbrand/scanner';

const root = document.querySelector('[data-barcode-scanner]');

if (root) {
    const $ = (selector) => root.querySelector(selector);
    const video = $('[data-preview]');
    const startButton = $('[data-start]');
    const stopButton = $('[data-stop]');
    const status = $('[data-status]');
    const form = $('[data-manual-form]');
    const input = $('[data-manual-input]');
    const manualFeedback = $('[data-manual-feedback]');
    const manualResult = $('[data-manual-result]');
    const dialog = $('[data-result-dialog]');
    const image = $('[data-image]');
    const manualImage = $('[data-manual-image]');

    const cameraErrors = {
        'permission-denied': 'Camera permission was denied. Allow access in your browser settings or enter the number below.',
        'insecure-context': 'Camera access needs HTTPS (or localhost) and a compatible browser. Enter a barcode below instead.',
        unsupported: 'Camera access needs HTTPS (or localhost) and a compatible browser. Enter a barcode below instead.',
        'detector-failed': 'The scanner failed to load. Please refresh the page.',
    };
    const lookupErrors = {
        'rate-limited': 'Too many lookups. Please wait a minute before trying again.',
        'lookup-failed': 'Lookup is unavailable right now. Please try again.',
    };
    const stateText = {
        idle: 'Camera off. Start it again or enter a barcode below.',
        starting: 'Starting camera… Please allow camera access if prompted.',
        scanning: 'Point your camera at a UPC or EAN barcode. The lookup starts automatically.',
        paused: 'Camera paused when you left this tab. Start it again to scan.',
    };

    let current = null; // last DetectedCode, to route messages to the camera or manual UI
    let lastTrigger = null;

    const setStatus = (message) => { status.textContent = message; };
    const setManualMessage = (message) => {
        manualResult.hidden = true;
        manualFeedback.textContent = message;
        manualFeedback.hidden = !message;
    };
    const isManual = () => current?.format === 'manual';
    const notify = (message) => (isManual() ? setManualMessage(message) : setStatus(message));
    const productDetails = (p) => [p.brand, p.styleCode, `${p.raw.sizes_count} ${p.raw.sizes_count === 1 ? 'barcode' : 'barcodes'} found`]
        .filter(Boolean).join('\n');
    const setImage = (element, url) => {
        element.hidden = true;
        element.removeAttribute('src');
        element.src = url;
        element.hidden = false;
    };
    const imageFallback = (event) => {
        const element = event.currentTarget;
        if (element.src !== root.dataset.fallbackImage) element.src = root.dataset.fallbackImage;
        else element.hidden = true;
    };

    const scanner = createScanner({
        video,
        wasmUrl, // keep self-hosting the wasm — no CDN on our site
        detector: 'zxing', // same decoder as today; 'auto' would try the native BarcodeDetector first
        // Same 8–15 digit rule as ScannerController, plus the GTIN checksum for camera reads.
        filter: (code) => /^[0-9]{8,15}$/.test(code.value) && (code.format === 'manual' || defaultFilter(code)),
        // The controller returns a flat payload; adapt it to the Product shape.
        lookup: urlLookup(root.dataset.lookupUrl.replace('__BARCODE__', '{barcode}'), {
            mapProduct: (d) => ({
                barcode: d.barcode,
                name: d.name,
                brand: d.brand,
                styleCode: d.style_code,
                imageUrl: d.image_url,
                pageUrl: d.page_url,
                raw: d,
            }),
        }),
    });

    scanner.on('state', (state) => {
        const live = state === 'starting' || state === 'scanning' || state === 'looking-up';
        startButton.hidden = live;
        stopButton.hidden = !live;
        if (state === 'starting') setManualMessage('');
        if (state === 'looking-up') {
            notify(isManual() ? `Looking up ${current.value}…` : `Looking up ${current.value}… Keep the barcode in view.`);
        } else if (stateText[state]) {
            setStatus(stateText[state]);
        }
    });
    scanner.on('detect', (code) => { current = code; });
    scanner.on('not-found', ({ code }) => {
        notify(code.format === 'manual'
            ? `No product found for ${code.value}. Check the digits and try another barcode.`
            : `No product found for ${code.value}. Keep scanning or enter another barcode.`);
    });
    scanner.on('product', ({ code, product }) => (code.format === 'manual' ? showManualMatch(code.value, product) : showMatch(code.value, product)));
    scanner.on('error', ({ code }) => {
        if (code === 'invalid-input') {
            setManualMessage('Enter 8 to 15 digits, with no spaces or letters.');
            input.focus();
        } else if (lookupErrors[code]) {
            notify(lookupErrors[code]);
        } else {
            setStatus(cameraErrors[code] ?? 'Could not start a camera. Check that it is connected and not in use, or enter the number below.');
        }
    });

    function showManualMatch(digits, p) {
        manualFeedback.hidden = true;
        $('[data-manual-value]').textContent = digits;
        $('[data-manual-name]').textContent = p.name;
        $('[data-manual-details]').textContent = productDetails(p);
        setImage(manualImage, p.imageUrl);
        $('[data-manual-link]').href = p.pageUrl;
        manualResult.hidden = false;
    }

    function showMatch(digits, p) {
        if (dialog.open) return;
        lastTrigger = document.activeElement;
        setStatus('Camera paused while you review the result.'); // the core already paused the camera
        $('[data-value]').textContent = digits;
        $('[data-lookup-status]').textContent = 'Product found';
        $('[data-name]').textContent = p.name;
        $('[data-details]').textContent = productDetails(p);
        setImage(image, p.imageUrl);
        $('[data-product]').hidden = false;
        const pageLink = $('[data-page-link]');
        pageLink.href = p.pageUrl;
        pageLink.hidden = false;
        dialog.showModal();
    }

    startButton.addEventListener('click', () => scanner.start());
    stopButton.addEventListener('click', () => scanner.stop());
    form.addEventListener('submit', (event) => {
        event.preventDefault();
        void scanner.lookup(input.value);
    });
    $('[data-scan-again]').addEventListener('click', () => {
        dialog.close();
        scanner.start();
    });
    dialog.addEventListener('close', () => { lastTrigger?.focus?.(); });
    image.addEventListener('error', imageFallback);
    manualImage.addEventListener('error', imageFallback);
    startButton.hidden = false;
    stopButton.hidden = true;
}
