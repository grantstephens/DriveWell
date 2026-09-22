/**
 * The accelerometer, behind a seam.
 *
 * The implementation lives in motion.native.ts; Metro picks it by platform
 * extension. This file exists so imports have something to resolve to for
 * TypeScript, and so the contract is stated once.
 *
 * The seam is what lets the Drive screen be tested in Jest: tests mock this
 * module and feed synthetic streams, which is also the only way to test the
 * screen against a *reproducible* drive.
 */

/** One accelerometer reading. x/y/z in g units; t is epoch milliseconds. */
export interface MotionSample {
  x: number;
  y: number;
  z: number;
  t: number;
}

/** A running motion subscription. */
export interface MotionSubscription {
  /** stop ends the subscription. Safe to call more than once. */
  stop(): void;
}

/**
 * startMotion begins delivering accelerometer samples to onSample at the
 * scoring sample rate (~50 Hz — fast enough that domain/scoring.ts's own
 * low-pass pre-filter can meaningfully reject aliased engine/road vibration,
 * which would otherwise fold down into false jerk at a slower rate; still
 * kind to the battery for a screen that is only ever live while driving). It
 * rejects if no accelerometer is available.
 */
export declare function startMotion(
  onSample: (sample: MotionSample) => void,
): Promise<MotionSubscription>;
