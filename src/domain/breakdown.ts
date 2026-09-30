/**
 * The end-of-drive breakdown: how the drive did on braking, cornering and
 * acceleration, each as a traffic light — the shareable, Wordle-style
 * counterpart to the single smoothness percentage.
 *
 * This is deliberately *separate* from scoring.ts. The smoothness engine is
 * orientation-independent by construction (it works off the accelerometer's
 * total magnitude, so it doesn't matter where the phone sits) and that
 * property is load-bearing. Telling braking from cornering is the opposite
 * problem: it needs to know which way is forward. So this class figures the
 * car's own axes out from the drive itself, after the fact, and touches
 * nothing the live score depends on.
 *
 * How, in order:
 *
 * 1. Gravity. A slow, self-protecting low-pass of the raw 3-axis reading
 *    gives "up" in the phone's own frame. It stops learning during sharp
 *    jolts and slows down while the car is accelerating hard, so the very
 *    forces being measured don't leak into the estimate of "up".
 * 2. Horizontal force. Subtract gravity, drop the vertical component (bumps
 *    and potholes are the smoothness score's business, not this one's), and
 *    smooth what's left. What remains is the car's horizontal acceleration,
 *    expressed in the phone's arbitrary frame.
 * 3. The car's axes. With a gyroscope, yaw rate (rotation about "up") is
 *    exactly the signal that says a corner is happening: lateral force is
 *    speed × yaw rate, and speed is never negative, so the horizontal force
 *    that correlates with yaw is the sideways axis, with a known sign (left).
 *    Forward is then fixed by the right-hand rule, sign included — which
 *    means braking versus acceleration is decided by geometry, not a
 *    heuristic like "braking hits harder" (wrong for a lead foot). Without a
 *    gyroscope, or on a drive with too little cornering to learn from,
 *    principal-component analysis of the horizontal force finds the dominant
 *    axis instead, and forward is guessed from which side is harsher. That
 *    fallback is honest about its limit: when the two horizontal axes carry
 *    comparable energy (a winding road) it cannot tell them apart, and says
 *    "unknown" rather than confidently mislabelling.
 * 4. Events. In each category, a harsh event is a stretch where the smoothed
 *    force stays above a threshold for a moment. The count becomes a light:
 *    none is green; a slip or two per ten minutes is amber; more is red.
 *
 * The thresholds sit where the harsh-driving literature puts them (roughly
 * 0.2-0.3 g sustained for a moment) and were sanity-checked against real
 * captured drives, but like every constant in this app they are first-pass
 * and live here, in one place, to be retuned.
 */
import type { AccelSample } from './scoring';

/** An accelerometer sample plus, when the phone has a gyroscope, its rotation rate (rad/s). */
export interface DriveSample extends AccelSample {
  gx?: number;
  gy?: number;
  gz?: number;
}

export type Light = 'green' | 'amber' | 'red' | 'unknown';

export interface CategoryResult {
  light: Light;
  /** events is how many harsh events were counted (0 when the light is unknown). */
  events: number;
}

export interface Breakdown {
  braking: CategoryResult;
  cornering: CategoryResult;
  acceleration: CategoryResult;
}

/** Sustained deceleration (g) that counts as harsh braking. */
const BRAKING_G = 0.25;
/** Sustained forward acceleration (g) that counts as harsh acceleration. */
const ACCELERATION_G = 0.2;
/** Sustained sideways acceleration (g) that counts as harsh cornering. */
const CORNERING_G = 0.3;

/** A stretch must stay over its threshold this long to be an event, not a blip. */
const MIN_EVENT_S = 0.4;
/** Dips shorter than this inside one stretch don't split it into two events. */
const EVENT_GAP_S = 0.3;

/** A trip is rated as if it were at least this long, so one slip in a short hop is amber at worst. */
const MIN_RATED_S = 300;
/** Events per ten minutes up to which a category is amber rather than red. */
const AMBER_MAX_PER_10_MIN = 2;

/** Time constant, seconds, smoothing horizontal force: about the shortest event worth counting. */
const SMOOTH_TC_S = 0.5;
/** Gravity learning speed while the car is quiet, and while it's busy, seconds. */
const GRAVITY_TC_QUIET_S = 2;
const GRAVITY_TC_BUSY_S = 30;
/** A reading this far off 1 g in magnitude is a jolt, not orientation information. */
const JOLT_MAGNITUDE_G = 0.5;
/** A reading this close to 1 g in magnitude can seed the gravity estimate. */
const GRAVITY_SEED_MAGNITUDE_G = 0.1;
/** Dynamic acceleration below this (g) counts as "quiet" for gravity learning. */
const QUIET_DYNAMIC_G = 0.1;

/** The first and last moments of a drive are handling the phone, not driving. */
const SETTLE_S = 5;
const TAIL_S = 1.5;

/** Horizontal samples are recorded at this interval, seconds — plenty for force smoothed over 0.5 s. */
const RECORD_INTERVAL_S = 0.1;

/** Yaw rate (rad/s) below which a moment doesn't count as turning. */
const TURNING_YAW_RAD_S = 0.05;
/** Turning samples needed before the gyroscope's axes are trusted (3 s at the record rate). */
const MIN_TURNING_SAMPLES = 30;
/** Minimum correlation between yaw rate and the sideways force it should explain. */
const MIN_YAW_CORRELATION = 0.35;

/** Horizontal force (g) a sample needs to take part in the fallback axis search. */
const PCA_MIN_G = 0.08;
/** Fallback only: the weaker horizontal axis may carry at most this share of the stronger's energy. */
const MAX_AXIS_ENERGY_RATIO = 0.7;
/** Fallback only: one side must be this much harsher than the other to be called braking. */
const SIDE_ASYMMETRY = 1.15;

type Vec = [number, number, number];

const dot = (a: Vec, b: Vec): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec, k: number): Vec => [a[0] * k, a[1] * k, a[2] * k];
const norm = (a: Vec): number => Math.sqrt(dot(a, a));
const cross = (a: Vec, b: Vec): Vec => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unit = (a: Vec): Vec => {
  const n = norm(a);
  return n > 0 ? scale(a, 1 / n) : a;
};

/**
 * lightForEvents turns an event count into a light: none is green; up to
 * AMBER_MAX_PER_10_MIN per ten minutes is amber; beyond that is red. Counts
 * are scaled by trip length (with a floor, see MIN_RATED_S) so a long drive
 * isn't punished for merely being long.
 */
export function lightForEvents(events: number, seconds: number): Light {
  if (events === 0) return 'green';
  const per10Min = events / (Math.max(seconds, MIN_RATED_S) / 600);
  return per10Min <= AMBER_MAX_PER_10_MIN ? 'amber' : 'red';
}

interface Axes {
  /** Unit vector pointing forward, in the phone's frame. */
  forward: Vec;
  /** Unit vector pointing left, in the phone's frame. */
  left: Vec;
}

export class DriveBreakdown {
  private gravity: Vec | null = null;
  private gravitySum: Vec = [0, 0, 0];
  private smoothed: Vec = [0, 0, 0];
  private smoothedYaw = 0;
  private hasGyro = false;
  private startT: number | null = null;
  private lastT = 0;
  private lastRecordS = -Infinity;

  /** Recorded, decimated: seconds since start, horizontal force xyz, yaw rate. */
  private times: number[] = [];
  private forces: Vec[] = [];
  private yaws: number[] = [];

  /** push feeds one sample. Samples with non-increasing t are ignored. */
  push(s: DriveSample): void {
    if (this.startT === null) this.startT = s.t;
    const a: Vec = [s.x, s.y, s.z];
    const magnitudeOff = Math.abs(norm(a) - 1);

    if (this.gravity === null) {
      // Wait for a sane reading to seed "up" — a phone being picked up and
      // mounted starts a drive with jolts that say nothing about orientation.
      if (magnitudeOff >= GRAVITY_SEED_MAGNITUDE_G) return;
      this.gravity = [...a];
      this.lastT = s.t;
      return;
    }
    const dt = (s.t - this.lastT) / 1000;
    if (dt <= 0) return;
    this.lastT = s.t;

    if (magnitudeOff < JOLT_MAGNITUDE_G) {
      const quiet = norm(sub(a, this.gravity)) < QUIET_DYNAMIC_G;
      const tc = quiet ? GRAVITY_TC_QUIET_S : GRAVITY_TC_BUSY_S;
      this.gravity = add(this.gravity, scale(sub(a, this.gravity), dt / (tc + dt)));
    }
    const up = unit(this.gravity);
    this.gravitySum = add(this.gravitySum, scale(up, dt));

    const dynamic = sub(a, this.gravity);
    const horizontal = sub(dynamic, scale(up, dot(dynamic, up)));
    const k = dt / (SMOOTH_TC_S + dt);
    this.smoothed = add(this.smoothed, scale(sub(horizontal, this.smoothed), k));

    if (s.gx !== undefined && s.gy !== undefined && s.gz !== undefined) {
      this.hasGyro = true;
      this.smoothedYaw += k * (dot([s.gx, s.gy, s.gz], up) - this.smoothedYaw);
    }

    const seconds = (s.t - this.startT) / 1000;
    if (seconds - this.lastRecordS >= RECORD_INTERVAL_S) {
      this.lastRecordS = seconds;
      this.times.push(seconds);
      this.forces.push([...this.smoothed]);
      this.yaws.push(this.hasGyro ? this.smoothedYaw : NaN);
    }
  }

  /** result rates the drive so far. Cheap enough to call once, at the end. */
  result(): Breakdown {
    const allGreen: Breakdown = {
      braking: { light: 'green', events: 0 },
      cornering: { light: 'green', events: 0 },
      acceleration: { light: 'green', events: 0 },
    };
    const n = this.times.length;
    if (n === 0) return allGreen;

    const endS = this.times[n - 1]!;
    const usable: number[] = [];
    for (let i = 0; i < n; i++) {
      if (this.times[i]! >= SETTLE_S && this.times[i]! <= endS - TAIL_S) usable.push(i);
    }

    const lowestThreshold = Math.min(BRAKING_G, ACCELERATION_G, CORNERING_G);
    if (!usable.some((i) => norm(this.forces[i]!) >= lowestThreshold)) return allGreen;

    const axes = this.gyroAxes(usable) ?? this.principalAxes(usable);
    if (axes === null) {
      const unknown: CategoryResult = { light: 'unknown', events: 0 };
      return { braking: unknown, cornering: unknown, acceleration: unknown };
    }

    const forward = usable.map((i) => dot(this.forces[i]!, axes.forward));
    const sideways = usable.map((i) => dot(this.forces[i]!, axes.left));
    const times = usable.map((i) => this.times[i]!);
    const seconds = endS;

    const rate = (series: number[], threshold: number): CategoryResult => {
      const events = countEvents(series, times, threshold);
      return { light: lightForEvents(events, seconds), events };
    };
    return {
      braking: rate(
        forward.map((f) => -f),
        BRAKING_G,
      ),
      cornering: rate(
        sideways.map((q) => Math.abs(q)),
        CORNERING_G,
      ),
      acceleration: rate(forward, ACCELERATION_G),
    };
  }

  /**
   * gyroAxes finds the car's axes from yaw rate: the horizontal force that
   * rises and falls with yaw is the sideways axis (lateral force = speed ×
   * yaw rate, and speed is never negative, so the sign is that of a left
   * turn), and forward follows from the right-hand rule. Null when there is
   * no gyroscope, or too little cornering to learn from.
   */
  private gyroAxes(usable: number[]): Axes | null {
    if (!this.hasGyro) return null;
    const up = unit(this.gravitySum);

    let c: Vec = [0, 0, 0];
    let turning = 0;
    for (const i of usable) {
      const yaw = this.yaws[i]!;
      if (Math.abs(yaw) < TURNING_YAW_RAD_S) continue;
      c = add(c, scale(this.forces[i]!, yaw));
      turning++;
    }
    if (turning < MIN_TURNING_SAMPLES) return null;
    const left = unit(sub(c, scale(up, dot(c, up))));
    if (norm(left) === 0) return null;

    let cov = 0;
    let yawPower = 0;
    let sidePower = 0;
    for (const i of usable) {
      const yaw = this.yaws[i]!;
      if (Math.abs(yaw) < TURNING_YAW_RAD_S) continue;
      const side = dot(this.forces[i]!, left);
      cov += yaw * side;
      yawPower += yaw * yaw;
      sidePower += side * side;
    }
    if (yawPower === 0 || sidePower === 0) return null;
    if (cov / Math.sqrt(yawPower * sidePower) < MIN_YAW_CORRELATION) return null;

    return { left, forward: cross(left, up) };
  }

  /**
   * principalAxes is the one-sensor fallback: the dominant direction of
   * horizontal force is taken to be forward-and-back, and whichever side of
   * it is harsher is taken to be braking. Null when the two horizontal axes
   * carry comparable energy (they can't be told apart) or the harsher side
   * isn't clearly harsher.
   */
  private principalAxes(usable: number[]): Axes | null {
    const samples = usable.map((i) => this.forces[i]!).filter((f) => norm(f) >= PCA_MIN_G);
    if (samples.length < MIN_TURNING_SAMPLES) return null;

    const cov: number[][] = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ];
    for (const v of samples) {
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) cov[r]![c]! += v[r]! * v[c]!;
    }
    const first = dominantEigen(cov, samples[0]!);
    const deflated = cov.map((row, r) => row.map((val, c) => val - first.value * first.vector[r]! * first.vector[c]!));
    const second = dominantEigen(deflated, orthogonalTo(first.vector));
    if (first.value <= 0 || second.value / first.value > MAX_AXIS_ENERGY_RATIO) return null;

    const along = first.vector;
    const side = (sign: number): number => {
      const mags = samples.map((v) => sign * dot(v, along)).filter((m) => m > 0.05);
      if (mags.length === 0) return 0;
      mags.sort((x, y) => x - y);
      return mags[Math.floor(mags.length * 0.9)]!;
    };
    const positive = side(1);
    const negative = side(-1);
    // The harsher side is braking, so forward points away from it.
    if (positive >= negative * SIDE_ASYMMETRY) return { forward: scale(along, -1), left: second.vector };
    if (negative >= positive * SIDE_ASYMMETRY) return { forward: along, left: second.vector };
    return null;
  }
}

/** countEvents counts stretches of `series` at or above `threshold` lasting at least MIN_EVENT_S. */
function countEvents(series: number[], times: number[], threshold: number): number {
  let events = 0;
  let start: number | null = null;
  let lastOn = 0;
  const close = (): void => {
    if (start !== null && times[lastOn]! - times[start]! >= MIN_EVENT_S) events++;
    start = null;
  };
  for (let i = 0; i < series.length; i++) {
    if (series[i]! >= threshold) {
      if (start === null) start = i;
      lastOn = i;
    } else if (start !== null && times[i]! - times[lastOn]! > EVENT_GAP_S) {
      close();
    }
  }
  close();
  return events;
}

/** dominantEigen finds the largest eigenvalue/vector of a symmetric 3×3 matrix by power iteration. */
function dominantEigen(m: number[][], seed: Vec): { value: number; vector: Vec } {
  let v = unit(seed);
  if (norm(v) === 0) v = [1, 0, 0];
  let value = 0;
  for (let iter = 0; iter < 100; iter++) {
    const next: Vec = [dot(m[0]! as Vec, v), dot(m[1]! as Vec, v), dot(m[2]! as Vec, v)];
    const len = norm(next);
    if (len === 0) return { value: 0, vector: v };
    value = len;
    v = scale(next, 1 / len);
  }
  return { value, vector: v };
}

/** orthogonalTo returns some unit vector perpendicular to `v`. */
function orthogonalTo(v: Vec): Vec {
  const axis: Vec = Math.abs(v[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  return unit(cross(v, axis));
}
