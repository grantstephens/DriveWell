import { computeStats } from './stats';
import type { Trip } from './trip';

function trip(startedAt: string, score: number, points = 10, seconds = 600): Trip {
  return { startedAt, endedAt: startedAt, seconds, score, points };
}

// Ten trips on consecutive hours: the first five average 60, the last five 80.
function tenTrips(): Trip[] {
  return Array.from({ length: 10 }, (_, i) =>
    trip(`2026-09-${String(10 + i).padStart(2, '0')}T08:00:00Z`, i < 5 ? 60 : 80, i + 1, 60),
  );
}

test('an empty history has no stats', () => {
  expect(computeStats([])).toEqual({
    totalTrips: 0,
    totalPoints: 0,
    totalSeconds: 0,
    bestScore: null,
    averageScore: null,
    recentAverage: null,
    earlierAverage: null,
    improvement: null,
  });
});

test('a single trip is its own best, average, and recent average', () => {
  const s = computeStats([trip('2026-09-20T08:00:00Z', 77.5, 30, 1200)]);
  expect(s).toEqual({
    totalTrips: 1,
    totalPoints: 30,
    totalSeconds: 1200,
    bestScore: 77.5,
    averageScore: 77.5,
    recentAverage: 77.5,
    earlierAverage: null,
    improvement: null,
  });
});

test('improvement compares the last five trips against the five before them', () => {
  const s = computeStats(tenTrips());
  expect(s.totalTrips).toBe(10);
  expect(s.recentAverage).toBeCloseTo(80, 10);
  expect(s.earlierAverage).toBeCloseTo(60, 10);
  expect(s.improvement).toBeCloseTo(20, 10);
  expect(s.bestScore).toBe(80);
  expect(s.averageScore).toBeCloseTo(70, 10);
  expect(s.totalPoints).toBe(55); // 1+2+…+10
  expect(s.totalSeconds).toBe(600);
});

test('five trips have no earlier window to compare against', () => {
  const s = computeStats(tenTrips().slice(5));
  expect(s.recentAverage).toBeCloseTo(80, 10);
  expect(s.earlierAverage).toBeNull();
  expect(s.improvement).toBeNull();
});

test('nine trips already show the improvement', () => {
  const s = computeStats(tenTrips().slice(0, 9));
  expect(s.earlierAverage).not.toBeNull(); // four trips in the earlier window
  // The recent window straddles the trend boundary — [60, 80, 80, 80, 80]
  // vs the four 60s before it.
  expect(s.improvement).toBeCloseTo(16, 10);
});

test('input order and duplicates do not change the story', () => {
  const trips = tenTrips();
  const shuffled = [...trips].reverse();
  const a = computeStats(shuffled);
  const b = computeStats([...trips, trips[trips.length - 1]!]);
  expect(a).toEqual(b);
});

test('a declining driver gets a negative improvement', () => {
  const s = computeStats(tenTrips().map((t) => ({ ...t, score: 100 - t.score })));
  expect(s.improvement).toBeCloseTo(-20, 10);
});
