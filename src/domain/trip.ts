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
  /** points is the gamification payout earned during the trip (see scoring.ts). */
  points: number;
}

/**
 * A trip shorter than this is discarded rather than saved — almost always an
 * accidental tap of Start immediately followed by End, not a real drive.
 */
export const MIN_TRIP_SECONDS = 5;
