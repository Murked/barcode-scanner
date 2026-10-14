import { useCallback, useEffect, useRef, useState } from 'react';
import { createScanner } from '../scanner';
import type { DetectedCode, Product, Scanner, ScannerOptions, ScannerState } from '../types';
import type { ScannerError } from '../errors';

export interface UseBarcodeScannerOptions<P = Product> extends Omit<ScannerOptions<P>, 'video'> {
  onDetect?: (code: DetectedCode) => void;
  onProduct?: (product: P, code: DetectedCode) => void;
  onNotFound?: (code: DetectedCode) => void;
  onError?: (error: ScannerError) => void;
}

/**
 * Headless core as a React hook: attach `videoRef` to your own `<video>` and render
 * whatever you like. Options are read once on mount, except the callbacks and the
 * `lookup` function, which always use the latest render's values.
 */
export function useBarcodeScanner<P = Product>(options: UseBarcodeScannerOptions<P> = {}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerRef = useRef<Scanner<P> | null>(null);
  const opts = useRef(options);
  opts.current = options; // latest callbacks without re-init

  const [state, setState] = useState<ScannerState>('idle');
  const [code, setCode] = useState<DetectedCode | null>(null);
  const [product, setProduct] = useState<P | null>(null);
  const [notFound, setNotFound] = useState<DetectedCode | null>(null);
  const [error, setError] = useState<ScannerError | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) throw new Error('useBarcodeScanner: attach videoRef to a <video> element');
    const { onDetect: _d, onProduct: _p, onNotFound: _n, onError: _e, ...init } = opts.current;
    const s = createScanner<P>({
      ...init,
      video,
      lookup: init.lookup && ((v, ctx) => (opts.current.lookup ?? init.lookup!)(v, ctx)),
    });
    scannerRef.current = s;
    const offs = [
      s.on('state', (st) => {
        setState(st);
        if (st === 'starting') setError(null);
      }),
      s.on('detect', (c) => {
        setCode(c);
        setProduct(null);
        setNotFound(null);
        setError(null);
        opts.current.onDetect?.(c);
      }),
      s.on('product', ({ code: c, product: p }) => {
        setProduct(() => p);
        opts.current.onProduct?.(p, c);
      }),
      s.on('not-found', ({ code: c }) => {
        setNotFound(c);
        opts.current.onNotFound?.(c);
      }),
      s.on('error', (err) => {
        setError(err);
        opts.current.onError?.(err);
      }),
    ];
    return () => {
      offs.forEach((off) => off());
      s.destroy();
      scannerRef.current = null;
    };
  }, []);

  return {
    videoRef,
    state,
    code,
    product,
    notFound,
    error,
    start: useCallback(() => scannerRef.current?.start() ?? Promise.resolve(), []),
    stop: useCallback(() => scannerRef.current?.stop(), []),
    pause: useCallback(() => scannerRef.current?.pause(), []),
    lookup: useCallback((v: string) => scannerRef.current?.lookup(v) ?? Promise.resolve(null), []),
    setTorch: useCallback((on: boolean) => scannerRef.current?.setTorch(on) ?? Promise.resolve(false), []),
    /** Core instance (escape hatch); `null` before mount. */
    scanner: scannerRef,
  };
}

export type UseBarcodeScannerResult<P = Product> = ReturnType<typeof useBarcodeScanner<P>>;
