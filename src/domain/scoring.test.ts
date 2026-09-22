import { GREEN_THRESHOLD, SmoothnessEngine } from './scoring';

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

/**
 * still: gravity only, zero variance, forever — the reading a phone lying
 * inert on a table produces. No real vehicle ever produces this exactly;
 * it exists to test the roughness/smoothness math in isolation and to
 * exercise the liveness gate's whole reason for existing.
 */
function still(orientation: { x: number; y: number; z: number }) {
  return () => orientation;
}

/**
 * driving: the same steady orientation, plus a tiny alternating dither
 * (±0.01 g) standing in for the engine/road vibration any real, even
 * perfectly smooth, vehicle produces. Comfortably above LIVENESS_EPSILON
 * (proves the engine is running), comfortably below the roughness floors
 * (does not meaningfully dent the smoothness score) — this is what
 * "smooth driving", not "an inert phone", actually looks like.
 */
function driving(orientation: { x: number; y: number; z: number }) {
  const axis = Math.abs(orientation.x) >= Math.abs(orientation.z) ? 'x' : 'z';
  return (i: number) => ({ ...orientation, [axis]: orientation[axis] + (i % 2 === 0 ? 0.01 : -0.01) });
}

/** A realistic braking/cornering ramp to a sustained magnitude, then a hold. */
function rampAndHold(peakG: number, rampSeconds: number) {
  const rampSamples = Math.round(rampSeconds * HZ);
  return (i: number) => {
    const g = i < rampSamples ? peakG * (i / rampSamples) : peakG;
    return { x: 1 + g, y: 0, z: 0 };
  };
}

test('a real, smooth drive scores 100 and racks up points at the full rate', () => {
  const e = new SmoothnessEngine();
  feed(e, 0, 10 * HZ + 1, driving({ x: 0, y: 0, z: 1 }));
  expect(e.smoothness).toBeGreaterThanOrEqual(99);
  expect(e.live).toBe(true);
  expect(e.seconds).toBeCloseTo(10, 6);
  expect(e.points).toBeGreaterThanOrEqual(9); // ~10 s × 1 point/s, minus a touch of EMA warm-up
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

// The second regression this engine exists to fix: an accelerometer cannot
// tell "parked" from "cruising at a constant velocity" apart (both are zero
// acceleration), so without a separate check, leaving a phone motionless on
// a table is indistinguishable from the smoothest drive imaginable.
describe('the liveness gate', () => {
  test('a phone left motionless on a table never earns points, no matter how long', () => {
    const e = new SmoothnessEngine();
    feed(e, 0, 90 * HZ + 1, still({ x: 0, y: 0, z: 1 }));
    // Smoothness stays an honest 100 — there is genuinely no roughness — but
    // nothing this still ever proves a vehicle is actually involved.
    expect(e.smoothness).toBe(100);
    expect(e.live).toBe(false);
    expect(e.points).toBe(0);
  });

  test('a real vehicle is recognized as live within a couple hundred milliseconds', () => {
    const e = new SmoothnessEngine();
    // Real vibration is continuous, not a single isolated blip — a two-step
    // rolling EMA needs at least a little sustained signal to accumulate.
    e.push({ x: 1.08, y: 0, z: 0, t: 0 });
    e.push({ x: 0.92, y: 0, z: 0, t: 100 });
    e.push({ x: 1.08, y: 0, z: 0, t: 200 });
    expect(e.live).toBe(true);
  });

  test('abandoning the phone mid-trip stops it earning further points after a grace period', () => {
    const e = new SmoothnessEngine();
    feed(e, 0, 20 * HZ + 1, driving({ x: 0, y: 0, z: 1 }));
    expect(e.live).toBe(true);
    const pointsWhileDriving = e.points;
    expect(pointsWhileDriving).toBeGreaterThan(0);

    // Put it down: dead silence for a full minute.
    feed(e, 20100, 60 * HZ + 1, still({ x: 0, y: 0, z: 1 }));
    expect(e.live).toBe(false);
    const pointsAfterAbandoned = e.points;

    // Another 30 s of the same silence must not add a single further point —
    // the grace period, whatever it is, has to actually end.
    feed(e, 80200, 30 * HZ + 1, still({ x: 0, y: 0, z: 1 }));
    expect(e.points).toBe(pointsAfterAbandoned);
    expect(e.points).toBeGreaterThan(pointsWhileDriving); // the grace period paid out *something*
  });

  test('a short, genuinely silent stop does not pause points — the grace period covers it', () => {
    const e = new SmoothnessEngine();
    feed(e, 0, 10 * HZ + 1, driving({ x: 0, y: 0, z: 1 })); // driving up to the light
    feed(e, 10100, 15 * HZ + 1, still({ x: 0, y: 0, z: 1 })); // stopped, genuinely silent, well under the grace window
    feed(e, 25300, 5 * HZ + 1, driving({ x: 0, y: 0, z: 1 })); // moving again
    expect(e.live).toBe(true);
    expect(e.points).toBeGreaterThan(0);
  });
});

test('a real panic-stop-grade brake still drags smoothness to 0 and stops the points', () => {
  const e = new SmoothnessEngine();
  // 5 s smooth driving, then a 1 g deceleration ramping in over 1 s and
  // held — a near-maximum-grip panic stop, not just firm braking.
  feed(e, 0, 5 * HZ + 1, driving({ x: 0, y: 0, z: 1 }));
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
  feed(e, 0, 5 * HZ + 1, driving({ x: 0, y: 0, z: 1 }));
  feed(e, 5100, HZ + 1, rampAndHold(1.0, 1));
  feed(e, 6200, 5 * HZ + 1, () => ({ x: 2, y: 0, z: 0 }));
  expect(e.smoothness).toBe(0);

  feed(e, 11400, HZ + 1, driving({ x: 0, y: 0, z: 1 }));
  // One second of clean driving does not forgive a hard brake: the EMA
  // (3 s time constant) is still carrying most of it.
  expect(e.smoothness).toBeLessThan(GREEN_THRESHOLD);

  // …but ~20 s of clean driving fully rehabilitates the leaf.
  feed(e, 12500, 20 * HZ + 1, driving({ x: 0, y: 0, z: 1 }));
  expect(e.smoothness).toBeGreaterThanOrEqual(99);
});

test('score is the time-weighted mean, not the final reading', () => {
  const e = new SmoothnessEngine();
  // 5 s perfect, then a panic-stop-grade brake held for 4 s — smoothness
  // bottoms out at 0 well before the end, but the trip average reflects
  // both phases, not just the ending.
  feed(e, 0, 5 * HZ + 1, driving({ x: 0, y: 0, z: 1 }));
  feed(e, 5100, HZ + 1, rampAndHold(1.0, 1));
  feed(e, 6200, 4 * HZ + 1, () => ({ x: 2, y: 0, z: 0 }));

  expect(e.smoothness).toBe(0);
  expect(e.score).toBeGreaterThan(58);
  expect(e.score).toBeLessThan(74);
});

test('points accrue proportionally between the green threshold and 100', () => {
  const e = new SmoothnessEngine();
  // A steady sustained offset chosen (empirically, including the dither's
  // own small contribution to jerk) to hold smoothness at exactly 90 while
  // dithered enough to stay live → points at (90−80)/20 = 0.5/s once settled.
  const steadyG = 0.08;
  feed(e, 0, 30 * HZ + 1, driving({ x: 1 + steadyG, y: 0, z: 0 }));
  expect(e.smoothness).toBe(90);

  // Measure accrual over a further 60 s window, once warmed up. The getter
  // is rounded for display, so the delta can land ±1 off the theoretical 30
  // depending on where each side's fraction rounds — real drift would show
  // up as many points off, not one.
  const before = e.points;
  feed(e, 30100, 60 * HZ + 1, driving({ x: 1 + steadyG, y: 0, z: 0 }));
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

test('a fresh engine has scored nothing, earned nothing, and proven nothing', () => {
  const e = new SmoothnessEngine();
  expect(e.smoothness).toBe(100); // no roughness recorded yet
  expect(e.score).toBe(100);
  expect(e.seconds).toBe(0);
  expect(e.points).toBe(0);
  expect(e.live).toBe(false);
});
