import type { ScannerState } from '../types';
import type { ScannerErrorCode } from '../errors';

export interface Messages {
  start: string;
  stop: string;
  torch: string;
  manualButton: string;
  manualPlaceholder: string;
  manualLabel: string;
  again: string;
  viewProduct: string;
  state: Record<ScannerState, string>;
  notFound: (value: string) => string;
  errors: Record<ScannerErrorCode, string>;
}

/** Partial overrides; `state` and `errors` are merged key by key. */
export type MessagesInput = Partial<Omit<Messages, 'state' | 'errors'>> & {
  state?: Partial<Messages['state']>;
  errors?: Partial<Messages['errors']>;
};

export const defaultMessages: Messages = {
  start: 'Start camera',
  stop: 'Stop',
  torch: 'Torch',
  manualButton: 'Look up',
  manualPlaceholder: 'Enter barcode',
  manualLabel: 'Barcode number',
  again: 'Scan again',
  viewProduct: 'View product',
  state: {
    idle: 'Camera off.',
    starting: 'Starting camera… Allow camera access if prompted.',
    scanning: 'Point your camera at a barcode.',
    'looking-up': 'Looking up…',
    paused: 'Camera paused.',
    error: '',
  },
  notFound: (v) => `No product found for ${v}. Keep scanning or try another barcode.`,
  errors: {
    unsupported: 'This browser cannot access a camera. Enter a barcode instead.',
    'insecure-context': 'Camera access needs HTTPS. Enter a barcode instead.',
    'permission-denied': 'Camera permission was denied. Allow access in your browser settings.',
    'no-camera': 'No camera found.',
    'camera-in-use': 'The camera is in use by another app.',
    'detector-failed': 'The scanner failed to load. Please refresh.',
    'invalid-input': 'Enter a valid barcode.',
    'lookup-failed': 'Lookup is unavailable right now. Please try again.',
    'rate-limited': 'Too many lookups. Please wait a minute.',
    unauthorized: 'Product lookup is not available right now.',
    'origin-not-allowed': 'Product lookup is not available on this website.',
    'quota-exceeded': 'Product lookup is not available right now.',
  },
};

export function mergeMessages(input: MessagesInput = {}, base: Messages = defaultMessages): Messages {
  return {
    ...base,
    ...stripUndefined(input),
    state: { ...base.state, ...stripUndefined(input.state ?? {}) },
    errors: { ...base.errors, ...stripUndefined(input.errors ?? {}) },
  };
}

function stripUndefined<T extends object>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}
