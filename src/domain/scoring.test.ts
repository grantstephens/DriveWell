import { GREEN_THRESHOLD, SmoothnessEngine, type AccelSample } from './scoring';

const HZ = 10; // a representative sample rate; the engine's math is dt-driven, not rate-pinned
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

/** A realistic braking/cornering ramp to a sustained magnitude, then a hold. */
function rampAndHold(peakG: number, rampSeconds: number) {
  const rampSamples = Math.round(rampSeconds * HZ);
  return (i: number) => {
    const g = i < rampSamples ? peakG * (i / rampSamples) : peakG;
    return { x: 1 + g, y: 0, z: 0 };
  };
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
  // Axis-aligned gravity is exactly 1 g, so the score is exactly 100.
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

// The regression this engine exists to fix: a phone in a moving car picks up
// engine and road vibration in the tens-of-Hz range, aliased by our sampling
// into what looks like sample-to-sample jerk. Without the low-pass pre-filter
// in scoring.ts, even mild vibration during genuinely careful driving
// collapsed the score to 0. It must not.
test('realistic vibration noise degrades gracefully instead of crashing the score', () => {
  const mild = new SmoothnessEngine();
  feed(mild, 0, 30 * HZ + 1, (i) => ({ x: 1 + (i % 2 === 0 ? 0.08 : -0.08), y: 0, z: 0 }));
  expect(mild.smoothness).toBeGreaterThanOrEqual(GREEN_THRESHOLD);

  // Much stronger vibration (a rough idle or poor road, alternating at the
  // Nyquist limit — a worst-case pattern for any low-pass filter) degrades
  // the score without zeroing it outright: a cliff here would be as wrong
  // as never penalizing anything.
  const rough = new SmoothnessEngine();
  feed(rough, 0, 30 * HZ + 1, (i) => ({ x: 1 + (i % 2 === 0 ? 0.15 : -0.15), y: 0, z: 0 }));
  expect(rough.smoothness).toBeGreaterThan(30);
  expect(rough.smoothness).toBeLessThan(GREEN_THRESHOLD);
});

test('a real panic-stop-grade brake still drags smoothness to 0 and stops the points', () => {
  const e = new SmoothnessEngine();
  // 5 s smooth, then a 1 g deceleration ramping in over 1 s and held — a
  // near-maximum-grip panic stop, not just firm braking.
  feed(e, 0, 5 * HZ + 1, still({ x: 0, y: 0, z: 1 }));
  feed(e, 5100, HZ + 1, rampAndHold(1.0, 1));
  feed(e, 6200, 5 * HZ + 1, () => ({ x: 2, y: 0, z: 0 }));

  expect(e.smoothness).toBe(0);
  const pointsAtZero = e.points;

  // Another 10 s held at the same deceleration: smoothness stays 0, points
  // stay frozen.
  feed(e, 11400, 10 * HZ + 1, () => ({ x: 2, y: 0, z: 0 }));
  expect(e.smoothness).toBe(0);
  expect(e.points).toBe(pointsAtZero);
});

test('smoothness recovers gradually after a harsh event ends, not instantly', () => {
  const e = new SmoothnessEngine();
  feed(e, 0, 5 * HZ + 1, still({ x: 0, y: 0, z: 1 }));
  feed(e, 5100, HZ + 1, rampAndHold(1.0, 1));
  feed(e, 6200, 5 * HZ + 1, () => ({ x: 2, y: 0, z: 0 }));
  expect(e.smoothness).toBe(0);

  feed(e, 11400, HZ + 1, still({ x: 0, y: 0, z: 1 }));
  // One second of stillness does not forgive a hard brake: the EMA (3 s time
  // constant) is still carrying most of it.
  expect(e.smoothness).toBeLessThan(GREEN_THRESHOLD);

  // …but ~20 s of clean driving fully rehabilitates the leaf.
  feed(e, 12500, 20 * HZ + 1, still({ x: 0, y: 0, z: 1 }));
  expect(e.smoothness).toBe(100);
});

test('score is the time-weighted mean, not the final reading', () => {
  const e = new SmoothnessEngine();
  // 5 s perfect, then a panic-stop-grade brake held for 4 s — smoothness
  // bottoms out at 0 well before the end, but the trip average reflects
  // both phases, not just the ending.
  feed(e, 0, 5 * HZ + 1, still({ x: 0, y: 0, z: 1 }));
  feed(e, 5100, HZ + 1, rampAndHold(1.0, 1));
  feed(e, 6200, 4 * HZ + 1, () => ({ x: 2, y: 0, z: 0 }));

  expect(e.smoothness).toBe(0);
  expect(e.score).toBeGreaterThan(58);
  expect(e.score).toBeLessThan(74);
});

test('points accrue proportionally between the green threshold and 100', () => {
  const e = new SmoothnessEngine();
  // A steady sustained offset chosen to hold smoothness at exactly 90 →
  // points at (90−80)/20 = 0.5/s once the EMA has settled.
  const steadyMag = 1.0866666666666667;
  feed(e, 0, 30 * HZ + 1, () => ({ x: steadyMag, y: 0, z: 0 }));
  expect(e.smoothness).toBe(90);

  // Measure accrual over a further 60 s window, once warmed up. The getter
  // is rounded for display, so the delta can land ±1 off the theoretical 30
  // depending on where each side's fraction rounds — real drift would show
  // up as many points off, not one.
  const before = e.points;
  feed(e, 30100, 60 * HZ + 1, () => ({ x: steadyMag, y: 0, z: 0 }));
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
  expect(e.score).toBeLessThan(100); // the one real step's jerk still counts
});

test('a fresh engine has scored nothing and owes nothing', () => {
  const e = new SmoothnessEngine();
  expect(e.smoothness).toBe(100); // no roughness recorded yet
  expect(e.score).toBe(100);
  expect(e.seconds).toBe(0);
  expect(e.points).toBe(0);
});
