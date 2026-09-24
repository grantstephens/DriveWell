/**
 * A Trip is one recorded drive: Start pressed, driving, End pressed.
 *
 * startedAt/endedAt are RFC3339 UTC with no fractional seconds (see
 * timestamp.ts). startedAt is the store's primary key — two trips cannot
 * begin in the same millisecond, and lexicographic order on these strings is
 * chronological order.
 */
export interface Trip {
  startedAt: string;
  endedAt: string;
  /** seconds is the driving duration in whole seconds. */
  seconds: number;
  /**
   * score is the trip's overall smoothness, 0-100: the time-weighted mean of
   * the instantaneous smoothness over every sample (see scoring.ts).
   */
  score: number;
}

/**
 * A trip shorter than this is discarded rather than saved — almost always an
 * accidental tap of Start immediately followed by End, not a real drive.
 */
export const MIN_TRIP_SECONDS = 5;

/**
 * isDriveWorthSaving decides whether a finished drive should become a
 * stored Trip at all — a fact about the drive, not about how a screen is
 * built, so it lives here rather than being inlined where a trip gets
 * saved. Requires both a real duration *and* real live time: `seconds`
 * alone isn't enough, since a phone left motionless on a table still
 * accumulates wall-clock seconds (see SmoothnessEngine.seconds) despite
 * never proving a vehicle was involved — it must not be saved as a trip,
 * let alone one that (now that score requires liveness) reports a
 * suspicious, unearned 100%.
 */
export function isDriveWorthSaving(seconds: number, liveSeconds: number): boolean {
  return seconds >= MIN_TRIP_SECONDS && liveSeconds >= MIN_TRIP_SECONDS;
}
