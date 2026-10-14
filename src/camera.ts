import type { CameraOptions } from './types';

export function openCamera(c: CameraOptions = {}): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      ...(c.deviceId
        ? { deviceId: { exact: c.deviceId } }
        : { facingMode: { ideal: c.facingMode ?? 'environment' } }),
      width: { ideal: c.width ?? 1920 },
      height: { ideal: c.height ?? 1080 },
    },
  });
}

export const stopStream = (s: MediaStream): void => s.getTracks().forEach((t) => t.stop());

type TorchCapabilities = MediaTrackCapabilities & { torch?: boolean };

export function hasTorch(stream: MediaStream): boolean {
  const track = stream.getVideoTracks()[0];
  return !!(track?.getCapabilities?.() as TorchCapabilities | undefined)?.torch;
}

export async function setTorch(stream: MediaStream, on: boolean): Promise<boolean> {
  if (!hasTorch(stream)) return false;
  try {
    await stream
      .getVideoTracks()[0]
      .applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
    return true;
  } catch {
    return false;
  }
}
