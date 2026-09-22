/**
 * Smoothness scoring, the heart of the app.
 *
 * The trick that makes this work with the phone in any mount orientation: use
 * the accelerometer's *total magnitude* m = |(x, y, z)| rather than any single
 * axis. At rest m ≈ 1 g (gravity alone), whichever way the phone points, so
 * gravity needs no filtering step — only *dynamic* acceleration (braking,
 * accelerating, swerving, bumps) moves m away from 1 g.
 *
 * v1 of this engine computed jerk directly from consecutive raw samples and
 * collapsed to 0 during ordinary, careful driving. The cause: a phone in a
 * moving car — even resting on a seat, let alone dash-mounted — picks up
 * engine and road vibration in the tens-of-Hz range, well above anything a
 * human driving maneuver produces (real braking/cornering/throttle inputs
 * unfold over roughly half a second to two seconds, i.e. well under 2 Hz).
 * Sampled at ~10-20 Hz, that vibration is badly undersampled: it aliases into
 * what looks like violent sample-to-sample jerk, exactly the failure mode
 * this engine is supposed to detect. v2 fixes this at the root — the
 * standard DSP answer to "real signal is slow, noise is fast, and I can't
 * sample fast enough to resolve the noise cleanly": low-pass the magnitude
 * *before* differencing it, then apply a small dead-band on top for whatever
 * the filter doesn't fully remove.
 *
 * Two signals are extracted from the filtered magnitude, both further
 * exponentially smoothed so a single pothole damps out over seconds rather
 * than zeroing the score:
 *
 * - jerk: |Δfiltered| / Δt (g/s) — how violently acceleration is *changing*.
 *   Rises on abrupt braking, throttle stabs, swerves, and sustained bumps.
 * - sustained: |filtered − 1 g| — steady-state dynamic acceleration. A long
 *   hard corner or a foot resting on the brake shows low jerk but high
 *   sustained.
 *
 * roughness combines them (sustained is scaled to g/s-equivalents), and
 * smoothness is the linear falloff from 100 at rest to 0 at BROWN_ROUGHNESS.
 *
 * Points: once smoothness reaches GREEN_THRESHOLD the leaf is "green" and
 * points accrue proportionally — 0/s at the threshold, POINTS_PER_SECOND at
 * smoothness 100. Sitting at a traffic light scores 100 and racks up points:
 * that is deliberate, stillness is smooth.
 *
 * The constants below — including the v2 filter and dead-band — were derived
 * against synthetic accelerometer-noise models (aliased engine/road
 * vibration at realistic amplitudes) and synthetic braking/cornering events,
 * not real on-road telemetry. They are calibrated so ordinary driving on a
 * merely bumpy road stays comfortably green while genuinely harsh braking or
 * cornering still visibly — and, if sustained, fully — tanks the score.
 * Expect to retune against real drives; they live here, and only here, so
 * that stays a one-file change.
 */

/** One accelerometer reading. x/y/z in g units; t is epoch milliseconds. */
export interface AccelSample {
  x: number;
  y: number;
  z: number;
  t: number;
}

/**
 * Low-pass time constant applied to the raw magnitude before differencing,
 * seconds. ~1 Hz cutoff: strongly attenuates engine/road vibration (tens of
 * Hz, aliased or not) while barely touching real driving-force changes,
 * which unfold over roughly half a second or slower.
 */
const SIGNAL_TC_S = 0.15;

/** EMA time constant, seconds, applied to jerk/sustained themselves. */
const EMA_TC_S = 3;

/** Residual filtered jerk below this (g/s) is sensor/mount noise, not driving. */
const JERK_FLOOR = 0.03;

/** Residual filtered sustained offset below this (g) is sensor/mount noise. */
const SUSTAINED_FLOOR = 0.02;

/** How many g/s of sustained offset equals 1 g/s of jerk, penalty-wise. */
const SUSTAINED_WEIGHT = 3;

/** roughness at and above which smoothness is 0. */
const BROWN_ROUGHNESS = 2.0;

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
  private filteredMag: number | null = null;
  private lastT = 0;
  private jerkEma = 0;
  private dynEma = 0;
  private smoothnessWeighted = 0;
  private secondsAcc = 0;
  private pointsAcc = 0;

  /** push feeds one sample. Samples with non-increasing t are ignored. */
  push(s: AccelSample): void {
    const mag = Math.hypot(s.x, s.y, s.z);
    if (this.filteredMag === null) {
      this.filteredMag = mag;
      this.lastT = s.t;
      return; // no Δt yet — nothing to differentiate
    }
    const dt = (s.t - this.lastT) / 1000;
    if (dt <= 0) return;

    const prevFiltered = this.filteredMag;
    const filterAlpha = dt / (SIGNAL_TC_S + dt);
    this.filteredMag = prevFiltered + filterAlpha * (mag - prevFiltered);

    const jerkRaw = Math.abs(this.filteredMag - prevFiltered) / dt;
    const sustainedRaw = Math.abs(this.filteredMag - GRAVITY_G);
    const jerk = Math.max(0, jerkRaw - JERK_FLOOR);
    const sustained = Math.max(0, sustainedRaw - SUSTAINED_FLOOR);

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
