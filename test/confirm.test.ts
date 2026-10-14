// Ported from barcodes-new/resources/js/scanner-confirmation.test.js
import { expect, test } from 'vitest';
import { createReadConfirmation } from '../src';

test('requires two reads of the same code within 1.8 seconds', () => {
  const confirm = createReadConfirmation();
  expect(confirm('123456789012', 1000)).toBe(false);
  expect(confirm('123456789012', 2800)).toBe(false); // outside the window
  expect(confirm('123456789012', 2900)).toBe(true);
  expect(confirm('123456789012', 2950)).toBe(false); // one lookup per sighting
});

test('another barcode or losing sight resets confirmation', () => {
  const confirm = createReadConfirmation();
  expect(confirm('123456789012', 1000)).toBe(false);
  expect(confirm('987654321098', 1200)).toBe(false);
  expect(confirm('987654321098', 1250)).toBe(true);
  expect(confirm('', 1300)).toBe(false);
  expect(confirm('987654321098', 1350)).toBe(false);
  expect(confirm('987654321098', 1400)).toBe(true);
});

test('respects a custom window', () => {
  const confirm = createReadConfirmation(100);
  expect(confirm('A', 0)).toBe(false);
  expect(confirm('A', 150)).toBe(false);
  expect(confirm('A', 200)).toBe(true);
});
