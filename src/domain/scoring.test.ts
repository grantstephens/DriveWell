import { GREEN_THRESHOLD, SmoothnessEngine, type AccelSample } from './scoring';

const HZ = 10; // the platform's sample rate; tests drive at the same rate
const STEP_MS = 1000 / HZ;

/**
 * feed pushes count samples starting at t=fromMs, with the reading produced
 * by sample(i, t). The first sample only initializes (no Δt), exactly as on
 * device — so `feed(e, 0, 101, ...)` spans a full 10.0 s of scored time.
 */
function feed(
  e: SmoothnessEngine,
  fromMs: number,
  count: number,
  sample: (i: number, t: number) => { x: number; y: number; z: number },
): void {
  for (let i = 0; i < count; i++) {
    const t = fromMs + i * STEP_MS;
    const { x, y, z } = sample(i, t);
    e.push({ x, y, z, t });
  }
}

/** stillness: gravity only, in some orientation. */
function still(orientation: { x: number; y: number; z: number }) {
  return () => orientation;
}

test('a motionless phone scores 100 and racks up points at the full rate', () => {
  const e = new SmoothnessEngine();
  feed(e, 0, 10 * HZ + 1, still({ x: 0, y: 0, z: 1 }));
  expect(e.smoothness).toBe(100);
  expect(e.score).toBe(100);
  expect(e.seconds).toBeCloseTo(10, 6);
  expect(e.points).toBe(10); // 10 s × 1 point/s at smoothness 100
});

test('scoring is orientation-independent: gravity alone never penalizes', () => {
  for (const orientation of [
    { x: 1, y: 0, z: 0 }, // phone lying flat
    { x: 0, y: -1, z: 0 }, // upside down
    // Diagonal mount: hypot(v, v, v) with v = 1/√3 folds back to exactly
    // 1 g in IEEE 754, so this is exact, not approximate.
    { x: 1 / Math.sqrt(3), y: 1 / Math.sqrt(3), z: 1 / Math.sqrt(3) },
  ]) {
    const e = new SmoothnessEngine();
    feed(e, 0, 10 * HZ + 1, still(orientation));
    expect(e.smoothness).toBe(100);
    expect(e.score).toBe(100);
  }
});

test('a hard brake drags smoothness to 0 and stops the points', () => {
  const e = new SmoothnessEngine();
  // 5 s smooth, then magnitude ramps 1 g → 1.5 g over 1 s (hard braking),
  // then holds the sustained 0.5 g (foot on the brake).
  feed(e, 0, 5 * HZ + 1, still({ x: 0, y: 0, z: 1 }));
  feed(e, 5100, HZ + 1, (i) => {
    const m = 1 + 0.5 * (i / HZ);
    return { x: m, y: 0, z: 0 };
  });
  feed(e, 6200, 5 * HZ + 1, () => ({ x: 1.5, y: 0, z: 0 }));

  expect(e.smoothness).toBe(0);
  const pointsAtZero = e.points;

  // Another 10 s of sustained brake: smoothness stays 0, points stay frozen.
  feed(e, 11400, 10 * HZ + 1, () => ({ x: 1.5, y: 0, z: 0 }));
  expect(e.smoothness).toBe(0);
  expect(e.points).toBe(pointsAtZero);
});

test('smoothness recovers gradually after roughness ends, not instantly', () => {
  const e = new SmoothnessEngine();
  // 1 s of violent oscillation, then stillness again.
  feed(e, 0, HZ + 1, (i) => ({ x: i % 2 === 0 ? 1.5 : 0.5, y: 0, z: 0 }));
  expect(e.smoothness).toBe(0);

  feed(e, 1100, HZ + 1, still({ x: 0, y: 0, z: 1 }));
  // One second of stillness does not forgive a second of violence: the EMA
  // (3 s time constant) is still carrying most of it.
  expect(e.smoothness).toBeLessThan(GREEN_THRESHOLD);

  // …but ~20 s of clean driving fully rehabilitates the leaf.
  feed(e, 2200, 20 * HZ + 1, still({ x: 0, y: 0, z: 1 }));
  expect(e.smoothness).toBe(100);
});

test('score is the time-weighted mean, not the final reading', () => {
  const e = new SmoothnessEngine();
  // 5 s perfect, then 10 s of violent oscillation (smoothness pinned near 0
  // after the EMA catches up ~0.4 s in).
  feed(e, 0, 5 * HZ + 1, still({ x: 0, y: 0, z: 1 }));
  feed(e, 5100, 10 * HZ + 1, (i) => ({ x: i % 2 === 0 ? 1.5 : 0.5, y: 0, z: 0 }));
  expect(e.score).toBeGreaterThan(25);
  expect(e.score).toBeLessThan(45); // ≈ 5 s × 100 + ~0.4 s × high, over 15 s
});

test('points accrue proportionally between the green threshold and 100', () => {
  const e = new SmoothnessEngine();
  // Steady cornering at |m−1| = 0.03 g: roughness 0.03×4 = 0.12 → smoothness
  // 90 → points at (90−80)/20 = 0.5/s once the EMA has settled.
  feed(e, 0, 30 * HZ + 1, () => ({ x: 1.03, y: 0, z: 0 }));
  expect(e.smoothness).toBe(90);

  // Measure accrual over a further 60 s window, once warmed up. The
  // getter is rounded for display, so the delta can land ±1 off the
  // theoretical 30 depending on where each side's fraction rounds —
  // real drift would show up as many points off, not one.
  const before = e.points;
  feed(e, 30100, 60 * HZ + 1, () => ({ x: 1.03, y: 0, z: 0 }));
  expect(e.points - before).toBeGreaterThanOrEqual(29);
  expect(e.points - before).toBeLessThanOrEqual(31);
});

test('samples with non-increasing timestamps are ignored', () => {
  const e = new SmoothnessEngine();
  e.push({ x: 0, y: 0, z: 1, t: 0 });
  e.push({ x: 0.9, y: 0, z: 0, t: 0 }); // same t: no Δt, no jerk
  e.push({ x: 0.9, y: 0, z: 0, t: 50 }); // backwards: ignored
  e.push({ x: 0, y: 0, z: 1, t: 100 }); // the only real step: 0.1 s
  expect(e.seconds).toBeCloseTo(0.1, 6);
  expect(e.score).toBeGreaterThan(0);
  expect(e.score).toBeLessThan(100); // the 1.7 g/s jerk this one step shows
});

test('a fresh engine has scored nothing and owes nothing', () => {
  const e = new SmoothnessEngine();
  expect(e.smoothness).toBe(100); // no roughness recorded yet
  expect(e.score).toBe(100);
  expect(e.seconds).toBe(0);
  expect(e.points).toBe(0);
});
