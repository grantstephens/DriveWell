import { SmoothnessEngine } from './scoring';

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

test('a real, smooth drive scores 100', () => {
  const e = new SmoothnessEngine();
  feed(e, 0, 10 * HZ + 1, driving({ x: 0, y: 0, z: 1 }));
  expect(e.smoothness).toBeGreaterThanOrEqual(99);
  expect(e.live).toBe(true);
  expect(e.seconds).toBeCloseTo(10, 6);
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
// Under the adaptive baseline, continuous vibration of any amplitude
// eventually reads as "normal" for this drive — that's the point. What
// must still hold: stronger vibration settles measurably lower than mild
// vibration, even at steady state, and neither one ever crashes to 0.
test('continuous vibration settles high regardless of amplitude, but stronger vibration still settles lower', () => {
  const mild = new SmoothnessEngine();
  feed(mild, 0, 30 * HZ + 1, (i) => ({ x: 1 + (i % 2 === 0 ? 0.08 : -0.08), y: 0, z: 0 }));
  expect(mild.smoothness).toBeGreaterThanOrEqual(90);

  const rough = new SmoothnessEngine();
  feed(rough, 0, 30 * HZ + 1, (i) => ({ x: 1 + (i % 2 === 0 ? 0.15 : -0.15), y: 0, z: 0 }));
  expect(rough.smoothness).toBeGreaterThanOrEqual(80);
  expect(rough.smoothness).toBeLessThan(mild.smoothness);
});

// The real bug this task fixes: captured motorway data showed jerkEma
// sitting at a steady 0.4-0.5 g/s for an entire highway cruise — 15x
// JERK_FLOOR — because real road vibration at speed (measured at 2.3-3.5 Hz)
// is close enough to the driving-event frequency band that a plain low-pass
// can't reject it. The fix: an adaptive baseline tracks "what's been normal
// recently" and only the excess above it counts as roughness.
test('continuous ambient vibration recovers toward 100 once the baseline catches up', () => {
  const e = new SmoothnessEngine();
  // Amplitude tuned to match real captured motorway data (steady-state
  // jerkEma ~0.4-0.9 g/s once settled) — this is deliberately "unrealistic"
  // vibration if judged by the old, un-baselined model (it would sit around
  // 65-70% forever), which is exactly the point.
  feed(e, 0, 5 * HZ + 1, (i) => ({ x: 0, y: 0, z: 1 + (i % 2 === 0 ? 0.18 : -0.18) }));
  const smoothnessBeforeSettling = e.smoothness;
  expect(smoothnessBeforeSettling).toBeLessThan(90); // the old-model-style dip, early on

  feed(e, 5100, 115 * HZ + 1, (i) => ({ x: 0, y: 0, z: 1 + (i % 2 === 0 ? 0.18 : -0.18) }));
  expect(e.smoothness).toBeGreaterThanOrEqual(93); // recovered once the baseline caught up
});

// The second regression this engine exists to fix: an accelerometer cannot
// tell "parked" from "cruising at a constant velocity" apart (both are zero
// acceleration), so without a separate check, leaving a phone motionless on
// a table is indistinguishable from the smoothest drive imaginable.
describe('the liveness gate', () => {
  test('a phone left motionless on a table is never live, no matter how long', () => {
    const e = new SmoothnessEngine();
    feed(e, 0, 90 * HZ + 1, still({ x: 0, y: 0, z: 1 }));
    // Smoothness stays an honest 100 — there is genuinely no roughness — but
    // nothing this still ever proves a vehicle is actually involved.
    expect(e.smoothness).toBe(100);
    expect(e.live).toBe(false);
    expect(e.score).toBe(100); // no live time was ever recorded
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

  test("abandoning the phone mid-trip freezes score's accumulation after a grace period", () => {
    const e = new SmoothnessEngine();
    feed(e, 0, 20 * HZ + 1, driving({ x: 0, y: 0, z: 1 }));
    expect(e.live).toBe(true);
    const scoreWhileDriving = e.score;

    // Put it down: dead silence for a full minute.
    feed(e, 20100, 60 * HZ + 1, still({ x: 0, y: 0, z: 1 }));
    expect(e.live).toBe(false);
    const scoreAfterAbandoned = e.score;

    // Another 30 s of the same silence must not move the score at all —
    // the grace period, whatever it is, has to actually end.
    feed(e, 80200, 30 * HZ + 1, still({ x: 0, y: 0, z: 1 }));
    expect(e.score).toBeCloseTo(scoreAfterAbandoned, 6);
    // The grace period's own driving-then-briefly-idle time still counted,
    // so the two checkpoints needn't be identical, but both must reflect
    // an actual driving trip, not the idle padding.
    expect(scoreWhileDriving).toBeGreaterThanOrEqual(99);
  });

  test('a short, genuinely silent stop does not pause score accumulation — the grace period covers it', () => {
    const e = new SmoothnessEngine();
    feed(e, 0, 10 * HZ + 1, driving({ x: 0, y: 0, z: 1 })); // driving up to the light
    feed(e, 10100, 15 * HZ + 1, still({ x: 0, y: 0, z: 1 })); // stopped, genuinely silent, well under the grace window
    feed(e, 25300, 5 * HZ + 1, driving({ x: 0, y: 0, z: 1 })); // moving again
    expect(e.live).toBe(true);
    expect(e.score).toBeGreaterThanOrEqual(99);
  });

  // The exploit LIVENESS_EPSILON alone cannot catch: a phone left mostly
  // motionless but tapped rhythmically every couple of seconds reads as
  // "live" under a bare amplitude check (the tap's amplitude alone clears
  // the epsilon), yet no vehicle is involved. Real engine/road vibration is
  // continuous — every sample carries some motion; a periodic tap is sparse
  // — long silent stretches between brief spikes. That's a duty-cycle
  // difference, not an amplitude one, so only a variance-based check (not a
  // bigger epsilon) can tell them apart.
  test('a phone tapped rhythmically to fake liveness does not count toward score once past the settle window', () => {
    const e = new SmoothnessEngine();
    let t = 0;
    e.push({ x: 0, y: 0, z: 1, t });
    t += 20;
    // A brief settle window (see SCORING_SETTLE_S) deliberately behaves like
    // the old, unhardened gate — that's the accepted, bounded cost of
    // needing a real duty cycle to measure before the burstiness veto means
    // anything. Feed well past it, then check the *marginal* score change
    // after settling, not the total — the settle window's own contribution
    // is not the exploit under test.
    for (let ms = 0; ms < 20_000; ms += 20) {
      const tapping = ms % 2000 < 60; // ~3 samples of tap per 2 s cycle
      e.push({ x: 0, y: 0, z: tapping ? 1.3 : 1, t });
      t += 20;
    }
    const settledScore = e.score;

    // 70 more seconds of the exact same rhythmic tap, entirely past the
    // settle window — a real engine wouldn't stop qualifying after 15-20 s
    // of itself; only sparse, bursty activity should.
    for (let ms = 20_000; ms < 90_000; ms += 20) {
      const tapping = ms % 2000 < 60;
      e.push({ x: 0, y: 0, z: tapping ? 1.3 : 1, t });
      t += 20;
    }
    expect(e.score).toBeCloseTo(settledScore, 6);
  });
});

test('a real panic-stop-grade brake still drags smoothness to 0', () => {
  const e = new SmoothnessEngine();
  // 5 s smooth driving, then a 1 g deceleration ramping in over 1 s and
  // held — a near-maximum-grip panic stop, not just firm braking.
  feed(e, 0, 5 * HZ + 1, driving({ x: 0, y: 0, z: 1 }));
  feed(e, 5100, HZ + 1, rampAndHold(1.0, 1));
  feed(e, 6200, 5 * HZ + 1, () => ({ x: 2, y: 0, z: 0 }));
  expect(e.smoothness).toBe(0);
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
  expect(e.smoothness).toBeLessThan(80);

  // …but ~20 s of clean driving fully rehabilitates the leaf.
  feed(e, 12500, 20 * HZ + 1, driving({ x: 0, y: 0, z: 1 }));
  expect(e.smoothness).toBeGreaterThanOrEqual(99);
});

test('score is the time-weighted mean over live time, not the final reading', () => {
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

test('score reflects only live driving time, not a long idle stretch afterward', () => {
  const e = new SmoothnessEngine();
  // 5 s smooth driving, a panic-stop-grade brake held for 4 s, then a brief
  // recovery back to ordinary driving — releasing the brake before parking,
  // not jumping the raw signal straight from a 2 g hold to dead-still (which
  // would itself register as one more abrupt jerk transient and confound
  // what this test is actually checking).
  feed(e, 0, 5 * HZ + 1, driving({ x: 0, y: 0, z: 1 }));
  feed(e, 5100, HZ + 1, rampAndHold(1.0, 1));
  feed(e, 6200, 4 * HZ + 1, () => ({ x: 2, y: 0, z: 0 }));
  feed(e, 10300, 20 * HZ + 1, driving({ x: 0, y: 0, z: 1 }));
  const scoreBeforeIdle = e.score;

  // Forget to end the trip: 90 s of the phone sitting perfectly still.
  // If idle time still counted, this would pad the average back toward
  // 100 — it must not.
  feed(e, 30400, 90 * HZ + 1, still({ x: 0, y: 0, z: 1 }));
  expect(e.live).toBe(false);
  expect(e.score).toBeCloseTo(scoreBeforeIdle, 6);
});

test('a trip with no live samples yet scores a perfect 100, not NaN', () => {
  const e = new SmoothnessEngine();
  feed(e, 0, 30 * HZ + 1, still({ x: 0, y: 0, z: 1 }));
  expect(e.live).toBe(false);
  expect(e.score).toBe(100);
});

test('samples with non-increasing timestamps are ignored', () => {
  const e = new SmoothnessEngine();
  e.push({ x: 0, y: 0, z: 1, t: 0 });
  e.push({ x: 0.9, y: 0, z: 0, t: 0 }); // same t: no Δt, no jerk
  e.push({ x: 0.9, y: 0, z: 0, t: -50 }); // backwards: ignored
  // A large, deliberately unrealistic magnitude jump (not a realistic drive
  // event) for the one real step, so it clearly crosses the liveness bar
  // within this single sample and survives the getters' rounding — a
  // subtler jump would be real too, but too small to observe through
  // score (which now requires live) or the rounded smoothness getter.
  e.push({ x: 3, y: 0, z: 0, t: 100 });
  expect(e.seconds).toBeCloseTo(0.1, 6);
  expect(e.live).toBe(true);
  expect(e.score).toBeGreaterThan(0);
  expect(e.score).toBeLessThan(100); // the one real step's jerk still counts
});

// The explicit, accepted tradeoff of an adaptive baseline: it's very good
// at rejecting *constant* noise, which is also why it eventually forgives
// continuously jerky driving held well beyond its own time constant — a
// narrower failure mode than today's "every highway drive scores ~70%
// forever" bug, but a real one, documented here rather than left implicit.
test('continuously jerky driving sustained well beyond the baseline window is gradually forgiven', () => {
  const e = new SmoothnessEngine();
  // An unambiguously harsh, continuously oscillating input — well beyond
  // any real ambient vibration amplitude this file's other tests use.
  const harsh = (i: number) => ({ x: 0, y: 0, z: 1 + (i % 2 === 0 ? 0.35 : -0.35) });
  feed(e, 0, 10 * HZ + 1, harsh);
  const smoothnessEarly = e.smoothness;
  expect(smoothnessEarly).toBeLessThan(50); // correctly flagged as harsh at first

  feed(e, 10100, 80 * HZ + 1, harsh);
  expect(e.smoothness).toBeGreaterThan(smoothnessEarly + 30); // substantially, though not fully, forgiven
});

test('sustained cornering or braking (a steady g-force, not jerk) is never forgiven', () => {
  const e = new SmoothnessEngine();
  feed(e, 0, HZ + 1, (i) => ({ x: 1 + 0.6 * (i / HZ), y: 0, z: 0 })); // ramp to a real lateral-g corner
  feed(e, 1100, 89 * HZ + 1, () => ({ x: 1.6, y: 0, z: 0 })); // hold it for 89 more seconds
  expect(e.smoothness).toBeLessThan(20); // still tanked — this path never had a baseline applied
});

test('a fresh engine has scored nothing and proven nothing', () => {
  const e = new SmoothnessEngine();
  expect(e.smoothness).toBe(100); // no roughness recorded yet
  expect(e.score).toBe(100);
  expect(e.seconds).toBe(0);
  expect(e.live).toBe(false);
});
