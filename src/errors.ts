export type ScannerErrorCode =
  | 'unsupported' // no getUserMedia
  | 'insecure-context' // not HTTPS/localhost
  | 'permission-denied'
  | 'no-camera'
  | 'camera-in-use'
  | 'detector-failed' // wasm failed to load, etc.
  | 'invalid-input' // manual lookup value rejected
  | 'lookup-failed'
  | 'rate-limited'
  | 'unauthorized' // lookup token missing, invalid, or lacks permission
  | 'quota-exceeded'; // lookup token has no API calls left

/** Errors carry stable codes, never user-facing English. UI layers translate codes. */
export class ScannerError extends Error {
  readonly code: ScannerErrorCode;
  override readonly cause?: unknown;

  constructor(code: ScannerErrorCode, cause?: unknown) {
    super(code);
    this.name = 'ScannerError';
    this.code = code;
    this.cause = cause;
  }
}

export function fromMediaError(e: unknown): ScannerError {
  if (e instanceof ScannerError) return e;
  const name = (e as { name?: string } | null)?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') return new ScannerError('permission-denied', e);
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return new ScannerError('no-camera', e);
  if (name === 'NotReadableError' || name === 'AbortError') return new ScannerError('camera-in-use', e);
  return new ScannerError('unsupported', e);
}
