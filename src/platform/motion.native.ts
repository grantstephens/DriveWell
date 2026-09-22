import { Accelerometer } from 'expo-sensors';

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
  const subscription = Accelerometer.addListener(({ x, y, z }) => {
    onSample({ x, y, z, t: Date.now() });
  });
  return {
    stop() {
      subscription.remove();
    },
  };
}
