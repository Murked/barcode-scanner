import type { DetectedCode } from './types';

const GTIN_FORMATS = new Set(['ean_13', 'ean_8', 'upc_a', 'upc_e']);

/** GTIN-8/12/13/14 mod-10 check digit. */
export function isValidGtin(v: string): boolean {
  if (!/^(\d{8}|\d{12,14})$/.test(v)) return false;
  const digits = [...v].map(Number);
  const check = digits.pop()!;
  const sum = digits.reverse().reduce((s, d, i) => s + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

/**
 * Expand an 8-digit UPC-E (number system + 6 digits + check) to its 12-digit UPC-A.
 * Returns null when the value is not an expandable UPC-E.
 */
export function expandUpcE(v: string): string | null {
  if (!/^[01]\d{7}$/.test(v)) return null;
  const ns = v[0];
  const d = v.slice(1, 7);
  const check = v[7];
  const last = d[5];
  let body: string;
  if (last <= '2') body = d.slice(0, 2) + last + '0000' + d.slice(2, 5);
  else if (last === '3') body = d.slice(0, 3) + '00000' + d.slice(3, 5);
  else if (last === '4') body = d.slice(0, 4) + '00000' + d[4];
  else body = d.slice(0, 5) + '0000' + last;
  return ns + body + check;
}

function isValidUpcE(v: string): boolean {
  // Some detectors omit the number system and/or check digit; nothing to verify then.
  if (/^\d{6}$/.test(v) || /^[01]\d{6}$/.test(v)) return true;
  const upcA = expandUpcE(v);
  return upcA !== null && isValidGtin(upcA);
}

/** Filters most misreads before they reach confirmation or the lookup. */
export const defaultFilter = ({ value, format }: DetectedCode): boolean => {
  if (format === 'upc_e') return isValidUpcE(value) || isValidGtin(value);
  return GTIN_FORMATS.has(format) ? isValidGtin(value) : value.length > 0;
};
