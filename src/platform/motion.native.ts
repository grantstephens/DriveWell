import { Accelerometer, Gyroscope } from 'expo-sensors';

import type { MotionSample, MotionSubscription } from './motion';

/**
 * ~50 Hz. Faster than domain/scoring.ts strictly needs for real driving
 * events, but sampling this fast is what lets its low-pass pre-filter
 * actually reject engine/road vibration (tens of Hz) instead of aliasing it
 * into noise indistinguishable from real jerk.
 */
const SAMPLE_INTERVAL_MS = 20;

export async function startMotion(
  onSample: (sample: MotionSample) => void,
): Promise<MotionSubscription> {
  const available = await Accelerometer.isAvailableAsync();
  if (!available) {
    throw new Error('No accelerometer on this device');
  }
  Accelerometer.setUpdateInterval(SAMPLE_INTERVAL_MS);

  // The gyroscope is a bonus: it tells the end-of-drive breakdown which way
  // is forward. Any trouble with it must never cost the drive itself.
  let rotation: { x: number; y: number; z: number } | null = null;
  let gyroSubscription: { remove(): void } | null = null;
  try {
    if (await Gyroscope.isAvailableAsync()) {
      Gyroscope.setUpdateInterval(SAMPLE_INTERVAL_MS);
      gyroSubscription = Gyroscope.addListener(({ x, y, z }) => {
        rotation = { x, y, z };
      });
    }
  } catch {
    gyroSubscription = null;
  }

  const subscription = Accelerometer.addListener(({ x, y, z }) => {
    const t = Date.now();
    onSample(rotation ? { x, y, z, t, gx: rotation.x, gy: rotation.y, gz: rotation.z } : { x, y, z, t });
  });
  return {
    stop() {
      subscription.remove();
      gyroSubscription?.remove();
    },
  };
}
