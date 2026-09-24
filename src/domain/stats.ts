import type { Trip } from './trip';

/**
 * Stats are the numbers on the Stats screen. They are always derived from the
 * stored trips and never stored themselves, which rules out a whole class of
 * cache-invalidation bugs — the same rule ReminDiary's stats follow.
 *
 * The improvement story compares the most recent 5 trips against the 5 before
 * them: enough trips to be a trend, few enough to respond within a week or
 * two of actually driving differently.
 */
export interface DriveStats {
  totalTrips: number;
  /** totalSeconds is lifetime driving time. */
  totalSeconds: number;
  /** bestScore is the highest trip score, null when there are no trips. */
  bestScore: number | null;
  /** averageScore is the mean over all trips, null when there are no trips. */
  averageScore: number | null;
  /** recentAverage is the mean score of the last 5 trips, null if none. */
  recentAverage: number | null;
  /** earlierAverage is the mean score of the 5 trips before those, null if none. */
  earlierAverage: number | null;
  /**
   * improvement is recentAverage − earlierAverage, the headline "you're
   * getting smoother" number, null until an earlier window exists (from the
   * 6th trip onward).
   */
  improvement: number | null;
}

/** How many trips each side of the improvement comparison uses. */
const TREND_WINDOW = 5;

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/**
 * computeStats derives statistics from stored trips. The input need not be
 * sorted and need not be free of duplicates.
 */
export function computeStats(trips: Trip[]): DriveStats {
  const sorted = [...new Map(trips.map((t) => [t.startedAt, t])).values()].sort(
    (a, b) => (a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : 0),
  );

  if (sorted.length === 0) {
    return {
      totalTrips: 0,
      totalSeconds: 0,
      bestScore: null,
      averageScore: null,
      recentAverage: null,
      earlierAverage: null,
      improvement: null,
    };
  }

  const scores = sorted.map((t) => t.score);
  const recent = scores.slice(-TREND_WINDOW);
  const earlier = scores.slice(-2 * TREND_WINDOW, -TREND_WINDOW);

  return {
    totalTrips: sorted.length,
    totalSeconds: sorted.reduce((a, t) => a + t.seconds, 0),
    bestScore: Math.max(...scores),
    averageScore: mean(scores),
    recentAverage: recent.length > 0 ? mean(recent) : null,
    earlierAverage: earlier.length > 0 ? mean(earlier) : null,
    improvement:
      recent.length > 0 && earlier.length > 0 ? mean(recent) - mean(earlier) : null,
  };
}
