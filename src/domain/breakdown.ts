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
 * 1. Gravity. The analysis runs once, at the end of the drive, so gravity is
 *    taken from the whole drive: a rolling median of the smoothed 3-axis
 *    reading (see gravityAt). Braking, accelerating and cornering push the
 *    reading both ways and average out; a fixed phone's tilt does not. An
 *    online low-pass estimate was tried first and failed on a real drive: the
 *    phone was still being tilted into its mount, the estimate took a minute
 *    to converge, and its ~0.16 g of tilt error leaked straight into
 *    "forward" — false accelerations, hidden brakes. A median over the whole
 *    trip has no startup transient at all.
 * 2. Horizontal force. Subtract gravity, drop the vertical component (bumps
 *    and potholes are the smoothness score's business, not this one's). What
 *    remains is the car's horizontal acceleration, expressed in the phone's
 *    arbitrary frame.
 *    Two kinds of moment are then set aside as not-driving: the first seconds
 *    after any hole in the sensor data (the app has just come back to the
 *    foreground, and the phone is being held), and any moment the gyroscope
 *    reports rotation about a horizontal axis — a car's body barely rolls or
 *    pitches, so that only happens when the phone itself is picked up, tapped
 *    or fiddled with. Both were seen on a real drive, as clusters of
 *    convincing-looking "harsh events" the moment the app returned.
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

/** Time constant, seconds, smoothing the raw reading: about the shortest event worth counting. */
const SMOOTH_TC_S = 0.5;
/** Gravity is re-estimated every GRAVITY_STEP_S, from a median over GRAVITY_HALF_WINDOW_S either side. */
const GRAVITY_STEP_S = 30;
const GRAVITY_HALF_WINDOW_S = 60;
/** Fewest samples a gravity window may hold before it widens (a stretch with no sensor data). */
const GRAVITY_MIN_SAMPLES = 50;
/** A silence in the sensor stream longer than this (seconds) is a gap, not slow sampling. */
const MAX_GAP_S = 1;

/** The first and last moments of a drive are handling the phone, not driving. */
const SETTLE_S = 5;
const TAIL_S = 1.5;
/** Likewise the seconds after the sensors come back from a hole (the app returning to the foreground). */
const POST_GAP_SETTLE_S = 10;
/**
 * Rotation about a horizontal axis (rad/s, smoothed) above which the phone is being
 * handled, not driven: real driving stays under ~0.1, picking it up reached 2.5.
 */
const HANDLING_RAD_S = 0.3;
/** Seconds either side of a handled moment that are also set aside. */
const HANDLING_MARGIN_S = 2;

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

interface HorizontalSeries {
  forces: Vec[];
  yaws: number[];
  /** Rotation about horizontal axes at each moment (rad/s); NaN without a gyroscope. */
  tumbles: number[];
  /** The drive's average "up" (unit vector, phone frame). */
  up: Vec;
  hasGyro: boolean;
}

interface Axes {
  /** Unit vector pointing forward, in the phone's frame. */
  forward: Vec;
  /** Unit vector pointing left, in the phone's frame. */
  left: Vec;
}

export class DriveBreakdown {
  private smoothedAccel: Vec | null = null;
  private smoothedGyro: Vec | null = null;
  private startT: number | null = null;
  private lastT = 0;
  private lastRecordS = -Infinity;
  private activeSeconds = 0;
  /** Seconds-since-start at which the sensors came back from a hole. */
  private gapEnds: number[] = [];

  /** Recorded, decimated: seconds since start, smoothed accelerometer xyz, smoothed gyro xyz (NaN if none). */
  private times: number[] = [];
  private accels: Vec[] = [];
  private gyros: Vec[] = [];

  /** push feeds one sample. Samples with non-increasing t are ignored. */
  push(s: DriveSample): void {
    if (this.startT === null) this.startT = s.t;
    const a: Vec = [s.x, s.y, s.z];
    const w: Vec | null =
      s.gx !== undefined && s.gy !== undefined && s.gz !== undefined ? [s.gx, s.gy, s.gz] : null;

    if (this.smoothedAccel === null) {
      this.smoothedAccel = a;
      this.smoothedGyro = w;
      this.lastT = s.t;
      return;
    }
    const dt = (s.t - this.lastT) / 1000;
    if (dt <= 0) return;
    this.lastT = s.t;

    if (dt > MAX_GAP_S) {
      // The sensors went quiet (the app was in the background, say) — start
      // smoothing afresh rather than smearing one side of the gap into the other.
      this.gapEnds.push((s.t - this.startT) / 1000);
      this.smoothedAccel = a;
      this.smoothedGyro = w;
    } else {
      this.activeSeconds += dt;
      const k = dt / (SMOOTH_TC_S + dt);
      this.smoothedAccel = add(this.smoothedAccel, scale(sub(a, this.smoothedAccel), k));
      if (w !== null) {
        this.smoothedGyro = this.smoothedGyro === null ? w : add(this.smoothedGyro, scale(sub(w, this.smoothedGyro), k));
      }
    }

    const seconds = (s.t - this.startT) / 1000;
    if (seconds - this.lastRecordS >= RECORD_INTERVAL_S) {
      this.lastRecordS = seconds;
      this.times.push(seconds);
      this.accels.push([...this.smoothedAccel]);
      this.gyros.push(this.smoothedGyro === null ? [NaN, NaN, NaN] : [...this.smoothedGyro]);
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

    const series = this.horizontalSeries();

    const endS = this.times[n - 1]!;
    const handled = this.handledTimes(series);
    const usable: number[] = [];
    let h = 0;
    for (let i = 0; i < n; i++) {
      const t = this.times[i]!;
      if (t < SETTLE_S || t > endS - TAIL_S) continue;
      if (this.gapEnds.some((g) => t >= g && t < g + POST_GAP_SETTLE_S)) continue;
      while (h < handled.length && handled[h]! < t - HANDLING_MARGIN_S) h++;
      if (h < handled.length && handled[h]! <= t + HANDLING_MARGIN_S) continue;
      usable.push(i);
    }

    const lowestThreshold = Math.min(BRAKING_G, ACCELERATION_G, CORNERING_G);
    if (!usable.some((i) => norm(series.forces[i]!) >= lowestThreshold)) return allGreen;

    const axes = this.gyroAxes(usable, series) ?? this.principalAxes(usable, series);
    if (axes === null) {
      const unknown: CategoryResult = { light: 'unknown', events: 0 };
      return { braking: unknown, cornering: unknown, acceleration: unknown };
    }

    const forward = usable.map((i) => dot(series.forces[i]!, axes.forward));
    const sideways = usable.map((i) => dot(series.forces[i]!, axes.left));
    const times = usable.map((i) => this.times[i]!);
    // Rated on the time the sensors were actually delivering, not wall-clock:
    // a drive with the app in the background for ten minutes wasn't ten
    // minutes of clean driving.
    const seconds = this.activeSeconds;

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

  /** handledTimes lists (ascending) the moments the gyroscope says the phone itself was being moved. */
  private handledTimes(series: HorizontalSeries): number[] {
    const out: number[] = [];
    series.tumbles.forEach((tumble, i) => {
      if (tumble >= HANDLING_RAD_S) out.push(this.times[i]!);
    });
    return out;
  }

  /**
   * horizontalSeries turns the recorded readings into what the rest needs:
   * horizontal force (gravity and the vertical component removed) and yaw
   * rate at each recorded moment, plus the drive's average "up".
   */
  private horizontalSeries(): HorizontalSeries {
    const gravity = this.gravityAt();
    const forces: Vec[] = [];
    const yaws: number[] = [];
    const tumbles: number[] = [];
    let upSum: Vec = [0, 0, 0];
    for (let i = 0; i < this.times.length; i++) {
      const g = gravity(this.times[i]!);
      const up = unit(g);
      upSum = add(upSum, up);
      const dynamic = sub(this.accels[i]!, g);
      forces.push(sub(dynamic, scale(up, dot(dynamic, up))));
      const yaw = dot(this.gyros[i]!, up);
      yaws.push(yaw);
      tumbles.push(norm(sub(this.gyros[i]!, scale(up, yaw))));
    }
    return { forces, yaws, tumbles, up: unit(upSum), hasGyro: yaws.some((y) => !Number.isNaN(y)) };
  }

  /**
   * gravityAt returns a function giving the gravity vector (in the phone's
   * frame) at any time: a median of the smoothed reading over a window either
   * side, recomputed every GRAVITY_STEP_S and interpolated between. Median,
   * per axis, because harsh braking is usually sharper than acceleration and a
   * mean would be dragged toward whichever side is harsher.
   */
  private gravityAt(): (seconds: number) => Vec {
    const first = this.times[0]!;
    const last = this.times[this.times.length - 1]!;
    const centres: number[] = [];
    const vectors: Vec[] = [];
    for (let c = first; c < last + GRAVITY_STEP_S; c += GRAVITY_STEP_S) {
      let window = this.indicesWithin(c, GRAVITY_HALF_WINDOW_S);
      if (window.length < GRAVITY_MIN_SAMPLES) window = this.indicesWithin(c, 5 * GRAVITY_HALF_WINDOW_S);
      if (window.length < GRAVITY_MIN_SAMPLES) window = this.times.map((_, i) => i);
      const axis = (k: number): number => median(window.map((i) => this.accels[i]![k]!));
      centres.push(c);
      vectors.push([axis(0), axis(1), axis(2)]);
    }
    return (seconds: number): Vec => {
      let j = 0;
      while (j + 1 < centres.length - 1 && centres[j + 1]! <= seconds) j++;
      const k = centres.length === 1 ? 0 : Math.min(1, Math.max(0, (seconds - centres[j]!) / (centres[j + 1]! - centres[j]!)));
      const a = vectors[j]!;
      const b = vectors[Math.min(j + 1, vectors.length - 1)]!;
      return add(scale(a, 1 - k), scale(b, k));
    };
  }

  private indicesWithin(centre: number, halfWindow: number): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.times.length; i++) {
      if (Math.abs(this.times[i]! - centre) <= halfWindow) out.push(i);
    }
    return out;
  }

  /**
   * gyroAxes finds the car's axes from yaw rate: the horizontal force that
   * rises and falls with yaw is the sideways axis (lateral force = speed ×
   * yaw rate, and speed is never negative, so the sign is that of a left
   * turn), and forward follows from the right-hand rule. Null when there is
   * no gyroscope, or too little cornering to learn from.
   */
  private gyroAxes(usable: number[], series: HorizontalSeries): Axes | null {
    if (!series.hasGyro) return null;
    const { forces, yaws, up } = series;

    let c: Vec = [0, 0, 0];
    let turning = 0;
    for (const i of usable) {
      const yaw = yaws[i]!;
      if (Math.abs(yaw) < TURNING_YAW_RAD_S) continue;
      c = add(c, scale(forces[i]!, yaw));
      turning++;
    }
    if (turning < MIN_TURNING_SAMPLES) return null;
    const left = unit(sub(c, scale(up, dot(c, up))));
    if (norm(left) === 0) return null;

    let cov = 0;
    let yawPower = 0;
    let sidePower = 0;
    for (const i of usable) {
      const yaw = yaws[i]!;
      if (Math.abs(yaw) < TURNING_YAW_RAD_S) continue;
      const side = dot(forces[i]!, left);
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
  private principalAxes(usable: number[], series: HorizontalSeries): Axes | null {
    const samples = usable.map((i) => series.forces[i]!).filter((f) => norm(f) >= PCA_MIN_G);
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

function median(values: number[]): number {
  const sorted = [...values].sort((x, y) => x - y);
  return sorted[Math.floor(sorted.length / 2)]!;
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
