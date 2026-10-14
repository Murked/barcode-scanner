import { describe, expect, test } from 'vitest';
import { defaultFilter, expandUpcE, isValidGtin } from '../src';

describe('isValidGtin', () => {
  test.each([
    '5012345678900', // EAN-13
    '4006381333931', // EAN-13
    '96385074', // EAN-8
    '036000291452', // UPC-A
    '10012345678902', // GTIN-14
  ])('accepts %s', (v) => expect(isValidGtin(v)).toBe(true));

  test('rejects EAN with a bad checksum', () => {
    expect(isValidGtin('5012345678901')).toBe(false);
  });

  test.each(['', '1234567', '12345678901', '123456789012345', '50123456789OO', ' 5012345678900'])(
    'rejects malformed %j',
    (v) => expect(isValidGtin(v)).toBe(false),
  );
});

describe('expandUpcE', () => {
  test.each([
    ['01234565', '012345000065'], // last digit 5..9
    ['04252614', '042100005264'], // last digit 0..2
    ['01234531', '012300000451'], // last digit 3
    ['01234543', '012340000053'], // last digit 4
  ])('expands %s', (e, a) => expect(expandUpcE(e)).toBe(a));

  test('rejects non UPC-E shapes', () => {
    expect(expandUpcE('21234565')).toBeNull();
    expect(expandUpcE('1234565')).toBeNull();
  });
});

describe('defaultFilter', () => {
  test('checks GTIN checksums for retail formats', () => {
    expect(defaultFilter({ value: '5012345678900', format: 'ean_13' })).toBe(true);
    expect(defaultFilter({ value: '5012345678901', format: 'ean_13' })).toBe(false);
    expect(defaultFilter({ value: '96385074', format: 'ean_8' })).toBe(true);
    expect(defaultFilter({ value: '036000291452', format: 'upc_a' })).toBe(true);
    expect(defaultFilter({ value: '036000291453', format: 'upc_a' })).toBe(false);
  });

  test('validates UPC-E via its UPC-A expansion', () => {
    expect(defaultFilter({ value: '01234565', format: 'upc_e' })).toBe(true);
    expect(defaultFilter({ value: '01234566', format: 'upc_e' })).toBe(false);
    expect(defaultFilter({ value: '123456', format: 'upc_e' })).toBe(true); // no check digit
  });

  test('accepts any non-empty value for other formats', () => {
    expect(defaultFilter({ value: 'ABC-123', format: 'code_128' })).toBe(true);
    expect(defaultFilter({ value: 'https://x.y', format: 'qr_code' })).toBe(true);
    expect(defaultFilter({ value: '', format: 'code_39' })).toBe(false);
    expect(defaultFilter({ value: '12345678', format: 'manual' })).toBe(true);
  });
});
