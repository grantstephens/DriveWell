/**
 * Smoothness scoring, the heart of the app.
 *
 * The trick that makes this work with the phone in any mount orientation: use
 * the accelerometer's *total magnitude* m = |(x, y, z)| rather than any single
 * axis. At rest m ≈ 1 g (gravity alone), whichever way the phone points, so
 * gravity needs no filtering step — only *dynamic* acceleration (braking,
 * accelerating, swerving, bumps) moves m away from 1 g.
 *
 * Two signals are extracted from m, both exponentially smoothed so a single
 * pothole spike damps out over seconds rather than zeroing the score:
 *
 * - jerk: |Δm| / Δt (g/s) — how violently acceleration is *changing*. Rises
 *   on abrupt braking, throttle stabs, swerves, and bumps.
 * - sustained: |m − 1 g| — steady-state dynamic acceleration. A long hard
 *   corner or a foot resting on the brake shows low jerk but high sustained.
 *
 * roughness combines them (sustained is scaled to g/s-equivalents), and
 * smoothness is the linear falloff from 100 at rest to 0 at BROWN_ROUGHNESS.
 *
 * Points: once smoothness reaches GREEN_THRESHOLD the leaf is "green" and
 * points accrue proportionally — 0/s at the threshold, POINTS_PER_SECOND at
 * smoothness 100. Sitting at a traffic light scores 100 and racks up points:
 * that is deliberate, stillness is smooth.
 *
 * The constants below are first-pass calibration from accelerometer physics
 * (hard braking ≈ 0.5 g over ≈ 1 s; gentle city driving ≈ 0.05-0.15 g/s
 * jerk), not from on-road telemetry — expect to tune them against real
 * drives. They live here, and only here, so tuning is a one-file change.
 */

/** One accelerometer reading. x/y/z in g units; t is epoch milliseconds. */
export interface AccelSample {
  x: number;
  y: number;
  z: number;
  t: number;
}

/** EMA time constant, seconds. ~3 s: a single spike decays in a few seconds. */
const EMA_TC_S = 3;

/** How many g/s of sustained |m−1g| equals 1 g/s of jerk, penalty-wise. */
const SUSTAINED_WEIGHT = 4;

/** roughness at and above which smoothness is 0. */
const BROWN_ROUGHNESS = 1.2;

/** Smoothness at which the leaf counts as green and points start accruing. */
export const GREEN_THRESHOLD = 80;

/** Points per second at smoothness 100 (the maximum accrual rate). */
export const POINTS_PER_SECOND = 1;

/** Resting gravity in g. The accelerometer's total magnitude at rest. */
const GRAVITY_G = 1;

/**
 * SmoothnessEngine turns a live stream of accelerometer samples into the
 * numbers the Drive screen shows. Create one per trip; push every sample as
 * it arrives; read the getters whenever the UI wants to repaint.
 *
 * Pure domain: no React, no Expo, no timers — time comes in on the samples,
 * which is what makes the whole thing testable against synthetic streams.
 */
export class SmoothnessEngine {
  private lastMag: number | null = null;
  private lastT = 0;
  private jerkEma = 0;
  private dynEma = 0;
  private smoothnessWeighted = 0;
  private secondsAcc = 0;
  private pointsAcc = 0;

  /** push feeds one sample. Samples with non-increasing t are ignored. */
  push(s: AccelSample): void {
    const mag = Math.hypot(s.x, s.y, s.z);
    if (this.lastMag === null) {
      this.lastMag = mag;
      this.lastT = s.t;
      return; // no Δt yet — nothing to differentiate
    }
    const dt = (s.t - this.lastT) / 1000;
    if (dt <= 0) return;

    const jerk = Math.abs(mag - this.lastMag) / dt;
    const sustained = Math.abs(mag - GRAVITY_G);
    const alpha = dt / (EMA_TC_S + dt);
    this.jerkEma += alpha * (jerk - this.jerkEma);
    this.dynEma += alpha * (sustained - this.dynEma);

    const smoothness = this.smoothnessNow();
    this.smoothnessWeighted += smoothness * dt;
    this.secondsAcc += dt;
    if (smoothness >= GREEN_THRESHOLD) {
      this.pointsAcc +=
        ((smoothness - GREEN_THRESHOLD) / (100 - GREEN_THRESHOLD)) *
        POINTS_PER_SECOND *
        dt;
    }

    this.lastMag = mag;
    this.lastT = s.t;
  }

  /** smoothness is the current instantaneous score, 0-100, rounded. */
  get smoothness(): number {
    return Math.round(this.smoothnessNow());
  }

  /**
   * score is the trip-so-far average: the time-weighted mean smoothness,
   * clamped to the documented 0-100 — a hundred 0.1 s additions of exactly
   * 100 can sum to 100.0000000000002, and a score above 100 would break the
   * leaf color mapping and every stat downstream. A trip with no timed
   * samples yet scores a perfect 100 — no movement recorded is no roughness
   * recorded.
   */
  get score(): number {
    if (this.secondsAcc === 0) return 100;
    return Math.min(100, this.smoothnessWeighted / this.secondsAcc);
  }

  /** seconds is the accumulated driving time. */
  get seconds(): number {
    return this.secondsAcc;
  }

  /**
   * points is the accrued payout, rounded — floor would show 599 for a
   * perfect ten minutes, because a hundred additions of 0.1 land at
   * 9.999999999999998 and nothing in the pipeline is ever exactly decimal.
   */
  get points(): number {
    return Math.round(this.pointsAcc);
  }

  private smoothnessNow(): number {
    const roughness = this.jerkEma + SUSTAINED_WEIGHT * this.dynEma;
    return Math.min(100, Math.max(0, 100 * (1 - roughness / BROWN_ROUGHNESS)));
  }
}
