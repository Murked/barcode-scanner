<?php

// routes/web.php (or routes/api.php) — lookup proxy for urlLookup('/api/lookup/{barcode}').
// config/services.php: 'barcodes' => ['key' => env('BARCODES_API_KEY'), 'url' => env('BARCODES_API_URL')]
//
// API URL and response field names are placeholders — align with the real Barcodes API.

use Illuminate\Support\Arr;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Route;

Route::get('/api/lookup/{barcode}', function (string $barcode) {
    $r = Http::withToken(config('services.barcodes.key'))
        ->timeout(5)
        ->get(rtrim(config('services.barcodes.url', 'https://api.yourbrand.com/v1/barcodes'), '/')."/{$barcode}");

    if ($r->notFound()) {
        return response()->json(['found' => false])->header('Cache-Control', 'no-store');
    }
    abort_unless($r->successful(), 502); // → 'lookup-failed'

    $p = $r->json();

    return response()->json([
        'found' => true,
        'product' => [
            'barcode' => $p['barcode'] ?? $barcode,
            'name' => $p['name'] ?? '',
            'brand' => $p['brand'] ?? null,
            'imageUrl' => $p['image'] ?? null,
            'pageUrl' => $p['url'] ?? null,
        ],
    ])->header('Cache-Control', 'no-store');
})
    ->where('barcode', '[0-9]{8,14}')
    ->middleware('throttle:30,1'); // 429 → 'rate-limited'
