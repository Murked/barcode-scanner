import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { useBarcodeScanner, type UseBarcodeScannerOptions } from '../src/react';
import { EAN, queuedDetector, setHidden, setSecureContext, stubGetUserMedia, stubVideoElement } from './helpers';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function Demo(props: UseBarcodeScannerOptions) {
  const { videoRef, state, code, product, notFound, error, start, stop, lookup } = useBarcodeScanner(props);
  return (
    <div>
      <video ref={videoRef} />
      <p data-testid="state">{state}</p>
      <p data-testid="code">{code?.value ?? ''}</p>
      <p data-testid="product">{product?.name ?? ''}</p>
      <p data-testid="not-found">{notFound?.value ?? ''}</p>
      <p data-testid="error">{error?.code ?? ''}</p>
      <button onClick={() => void start()}>start</button>
      <button onClick={() => stop()}>stop</button>
      <button onClick={() => void lookup('4006381333931')}>manual</button>
    </div>
  );
}

const text = (id: string) => screen.getByTestId(id).textContent;
const click = async (name: string) => {
  await act(async () => {
    screen.getByText(name).click();
    await vi.advanceTimersByTimeAsync(0);
  });
};
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

beforeEach(() => {
  vi.useFakeTimers();
  setSecureContext(true);
  setHidden(false);
  stubVideoElement();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

test('drives the core and exposes reactive state', async () => {
  stubGetUserMedia();
  const onDetect = vi.fn();
  const onProduct = vi.fn();
  render(
    <Demo
      detector={queuedDetector([EAN, EAN])}
      lookup={async (barcode) => ({ found: true, product: { barcode, name: 'Shoe' } })}
      onDetect={onDetect}
      onProduct={onProduct}
    />,
  );
  expect(text('state')).toBe('idle');

  await click('start');
  expect(text('state')).toBe('scanning');

  await advance(500);
  expect(text('code')).toBe(EAN);
  expect(text('product')).toBe('Shoe');
  expect(text('state')).toBe('paused');
  expect(onDetect).toHaveBeenCalledWith({ value: EAN, format: 'ean_13' });
  expect(onProduct).toHaveBeenCalledWith({ barcode: EAN, name: 'Shoe' }, { value: EAN, format: 'ean_13' });
});

test('uses the latest lookup and callbacks without re-creating the scanner', async () => {
  const { getUserMedia } = stubGetUserMedia();
  const first = vi.fn(async () => ({ found: false as const }));
  const second = vi.fn(async () => ({ found: false as const }));
  const onNotFound = vi.fn();
  const detector = queuedDetector([]);
  const { rerender } = render(<Demo detector={detector} lookup={first} />);
  rerender(<Demo detector={detector} lookup={second} onNotFound={onNotFound} />);

  await click('manual');
  expect(first).not.toHaveBeenCalled();
  expect(second).toHaveBeenCalledWith('4006381333931', expect.anything());
  expect(onNotFound).toHaveBeenCalledWith({ value: '4006381333931', format: 'manual' });
  expect(text('not-found')).toBe('4006381333931');
  expect(getUserMedia).not.toHaveBeenCalled();
});

test('surfaces errors as ScannerError codes', async () => {
  stubGetUserMedia(async () => {
    throw new DOMException('denied', 'NotAllowedError');
  });
  const onError = vi.fn();
  render(<Demo detector={queuedDetector([])} onError={onError} />);
  await click('start');
  expect(text('state')).toBe('error');
  expect(text('error')).toBe('permission-denied');
  expect(onError.mock.calls[0][0].code).toBe('permission-denied');
});

test('unmount (and StrictMode double-mount) releases the camera', async () => {
  const { streams } = stubGetUserMedia();
  const { unmount } = render(
    <StrictMode>
      <Demo detector={queuedDetector([])} />
    </StrictMode>,
  );
  await click('start');
  expect(text('state')).toBe('scanning');
  expect(streams).toHaveLength(1);
  unmount();
  expect(streams[0].track.stop).toHaveBeenCalled();
});
