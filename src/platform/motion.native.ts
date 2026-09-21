import { Accelerometer } from 'expo-sensors';

import type { MotionSample, MotionSubscription } from './motion';

/** ~10 Hz: catches a 0.5 g braking ramp, kind to the battery. */
const SAMPLE_INTERVAL_MS = 100;

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
