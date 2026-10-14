import { useState, type CSSProperties, type FormEvent } from 'react';
import { urlLookup, type ScannerErrorCode } from '@yourbrand/scanner';
import { useBarcodeScanner } from '@yourbrand/scanner/react';
// Self-host the zxing wasm (Vite resolves this to a hashed asset URL).
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';

// The core emits codes; the words are yours.
const errorText: Record<ScannerErrorCode, string> = {
  unsupported: 'This browser cannot use a camera.',
  'insecure-context': 'Camera needs HTTPS.',
  'permission-denied': 'Camera permission denied.',
  'no-camera': 'No camera found.',
  'camera-in-use': 'Camera is busy.',
  'detector-failed': 'Scanner failed to load.',
  'invalid-input': 'That is not a valid barcode.',
  'lookup-failed': 'Lookup failed, try again.',
  'rate-limited': 'Slow down a little.',
};

export function App() {
  const [manual, setManual] = useState('');
  const { videoRef, state, code, product, notFound, error, start, stop, lookup } = useBarcodeScanner({
    // Point this at your own proxy (see examples/proxy-server).
    lookup: urlLookup('/api/lookup/{barcode}'),
    wasmUrl,
    onDetect: (c) => console.log('scanned', c.value),
  });

  const live = state === 'starting' || state === 'scanning' || state === 'looking-up';
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void lookup(manual);
  };

  return (
    <main style={styles.main}>
      <h1>React hook</h1>
      <div style={styles.frame}>
        <video ref={videoRef} muted playsInline style={styles.video} />
      </div>
      <p>
        {live ? <button onClick={stop}>Stop</button> : <button onClick={() => void start()}>Scan</button>}{' '}
        <small>state: {state}</small>
      </p>
      <form onSubmit={onSubmit}>
        <input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="Enter barcode" inputMode="numeric" />
        <button type="submit">Look up</button>
      </form>
      {error && <p style={{ color: '#b91c1c' }}>{errorText[error.code]}</p>}
      {notFound && <p>No product for {notFound.value}.</p>}
      {product && code && (
        <article style={styles.card}>
          {product.imageUrl && <img src={product.imageUrl} alt="" width={64} height={64} />}
          <div>
            <strong>{product.name}</strong>
            <div>{[product.brand, product.styleCode].filter(Boolean).join(' · ')}</div>
            <code>{code.value}</code>
          </div>
        </article>
      )}
    </main>
  );
}

const styles: Record<string, CSSProperties> = {
  main: { maxWidth: 480, margin: '2rem auto', fontFamily: 'system-ui, sans-serif' },
  frame: { borderRadius: 16, overflow: 'hidden', background: '#000', aspectRatio: '1 / 1' },
  video: { width: '100%', height: '100%', objectFit: 'cover' },
  card: { display: 'flex', gap: 12, alignItems: 'center', padding: 12, border: '1px solid #e5e7eb', borderRadius: 12 },
};
