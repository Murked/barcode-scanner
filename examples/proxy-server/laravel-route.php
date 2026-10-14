<?php

// routes/web.php — lookup proxy for urlLookup('/api/lookup/{barcode}')
// or <barcode-scanner lookup-url="/api/lookup/{barcode}">.
// config/services.php: 'barcodes' => ['key' => env('BARCODES_API_KEY')]

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Route;

Route::get('/api/lookup/{barcode}', function (string $barcode) {
    $r = Http::withToken(config('services.barcodes.key'))
        ->acceptJson()
        ->timeout(5)
        ->get("https://barcodes.gg/api/v2/barcode/lookup/{$barcode}", ['fields' => '*']);

    abort_unless($r->successful(), 502); // → 'lookup-failed'

    $p = $r->json('product');
    if ($r->json('error') || ! $p) {
        return response()->json(['found' => false])->header('Cache-Control', 'no-store');
    }

    return response()->json([
        'found' => true,
        'product' => [
            'barcode' => $barcode,
            'name' => $p['product_name'],
            'brand' => $p['product_brand'],
            'styleCode' => $p['product_style_code'],
            'imageUrl' => $p['product_image'],
            'pageUrl' => "https://barcodes.gg/barcode/{$barcode}",
        ],
    ])->header('Cache-Control', 'no-store');
})
    ->where('barcode', '[0-9]{8,15}')
    ->middleware('throttle:30,1'); // 429 → 'rate-limited'
