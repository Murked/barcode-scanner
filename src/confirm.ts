// Ported from barcodes-new/resources/js/scanner-confirmation.js.
// One confirmed read per uninterrupted sighting of a code: the same value must be
// seen twice within `windowMs`, and it will not confirm again until the code leaves
// view (an empty read) or another code is seen.
export function createReadConfirmation(windowMs = 1800) {
  let lastValue = '';
  let lastAt = 0;
  let attempted = '';

  return (value: string, now = Date.now()): boolean => {
    if (!value) {
      lastValue = '';
      attempted = '';
      return false;
    }
    if (value === attempted) return false;
    if (value === lastValue && now - lastAt < windowMs) {
      attempted = value;
      return true;
    }
    lastValue = value;
    lastAt = now;
    return false;
  };
}
