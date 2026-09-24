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
 * `score` is the trip-so-far time-weighted average of smoothness — but
 * only over time proven *live*. An accelerometer cannot tell "parked" from
 * "cruising at a perfectly constant velocity" apart — both read as zero
 * acceleration, a direct consequence of Newton's first law, not a bug to
 * filter around. Without a second check, a phone left motionless on a
 * table would score identically to the smoothest drive imaginable, padding
 * a rough trip's average with "perfect" idle time. `live` closes that gap:
 * a rolling EMA of the *raw*, unfloored jerk/sustained signal — the same
 * "any real vehicle vibrates" fact the section above spends so much effort
 * filtering *out* of the roughness score is exactly what proves a phone is
 * actually in a running, moving vehicle in the first place. A truly inert
 * phone (sensor noise only, many times smaller than the smallest real
 * vehicle vibration) never crosses LIVENESS_EPSILON; any real vehicle
 * crosses it within a sample or two. `score`'s accumulation requires both
 * `live` and (once a trip has run long enough — see SCORING_SETTLE_S) a
 * non-bursty activity signal, so a table never contributes to the average
 * no matter how long it sits there, and a phone abandoned mid-trip stops
 * contributing once ACTIVITY_TC_S's rolling window decays past the
 * threshold (a bounded grace period, not a hard cutoff, so an ordinary
 * traffic stop with the engine idling doesn't get excluded for the same
 * stillness that a table produces). `smoothness` (the instantaneous
 * reading) stays true regardless of `live` — it answers "how rough was
 * whatever motion happened", which stays a true statement (there was none)
 * even while `live` is false; only `score`'s accumulation gates on it. The
 * one case this cannot catch — sitting in a parked car with the engine
 * running — is the same physical-limitation trade a speedometer-free,
 * GPS-free design accepts everywhere else in this app.
 *
 * The constants below — including the v2 filter, dead-band, and liveness
 * gate — were derived against synthetic accelerometer-noise models (aliased
 * engine/road vibration at realistic amplitudes) and synthetic
 * braking/cornering events, not real on-road telemetry. They are calibrated
 * so ordinary driving on a merely bumpy road stays comfortably green while
 * genuinely harsh braking or cornering still visibly — and, if sustained,
 * fully — tanks the score. Expect to retune against real drives; they live
 * here, and only here, so that stays a one-file change.
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

/**
 * Rolling time constant, seconds, for the liveness-activity EMA. Long
 * enough to ride through an ordinary traffic stop with the engine idling
 * (~30 s of grace) without pausing points; short enough that a phone
 * genuinely abandoned mid-trip stops earning within under a minute rather
 * than indefinitely.
 */
const ACTIVITY_TC_S = 8;

/**
 * The liveness-activity EMA must clear this (g or g/s) before points
 * accrue. Set far below any real vehicle's vibration (which clears it
 * within a sample or two of an engine actually running) and far above bare
 * sensor noise (which never does) — the gap between those two is large
 * enough that the exact value only matters at the margins.
 */
const LIVENESS_EPSILON = 0.005;

/**
 * An amplitude threshold alone cannot tell continuous engine/road vibration
 * apart from a phone left still and rhythmically tapped every so often —
 * the tap's amplitude clears LIVENESS_EPSILON just fine. What actually
 * differs is duty cycle: real vibration touches nearly every sample, a
 * periodic tap is sparse spikes in long silent stretches. `activityPowerEma`
 * (the EMA of activityLevel²) plus `activityEma` gives a normalized
 * variance — variance / mean² — that stays near 0 for continuous activity
 * and rises sharply for sparse, bursty activity, regardless of amplitude.
 * Above this ratio, activity is judged too bursty to be a real engine.
 */
const ACTIVITY_BURSTINESS_LIMIT = 3;

/**
 * The burstiness ratio needs several seconds of data to mean anything — a
 * duty cycle can't be measured faster than roughly one cycle of whatever
 * it's measuring. Before a trip has run this long, `score` accumulation
 * falls back to the plain amplitude (`live`) check, same as before this
 * gate existed. This is a deliberate, bounded gap, not an oversight: it
 * only makes rapid, repeated short trips a (much higher-effort,
 * self-limiting) residual exploit path, while closing the realistic one —
 * a phone left tapped and unattended for a long stretch.
 */
const SCORING_SETTLE_S = 15;

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
  private activityEma = 0;
  private activityPowerEma = 0;
  private smoothnessWeighted = 0;
  private secondsAcc = 0;
  private liveSecondsAcc = 0;

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

    const activityLevel = Math.max(jerkRaw, sustainedRaw);
    const activityAlpha = dt / (ACTIVITY_TC_S + dt);
    this.activityEma += activityAlpha * (activityLevel - this.activityEma);
    this.activityPowerEma += activityAlpha * (activityLevel * activityLevel - this.activityPowerEma);

    const smoothness = this.smoothnessNow();
    this.secondsAcc += dt;
    if (this.live && this.scoringEligible) {
      this.smoothnessWeighted += smoothness * dt;
      this.liveSecondsAcc += dt;
    }

    this.lastT = s.t;
  }

  /** smoothness is the current instantaneous score, 0-100, rounded. */
  get smoothness(): number {
    return Math.round(this.smoothnessNow());
  }

  /**
   * score is the trip-so-far average: the time-weighted mean smoothness
   * over *live* driving time only, clamped to the documented 0-100 — a
   * hundred 0.1 s additions of exactly 100 can sum to 100.0000000000002,
   * and a score above 100 would break the leaf color mapping and every
   * stat downstream. Excluding non-live time matters more now that score
   * is the app's only headline number: a phone left running after you've
   * parked must not pad a rough trip's average back toward 100 with
   * "perfect" idle stillness. A trip with no live samples yet scores a
   * perfect 100 — no driving recorded is no roughness recorded.
   */
  get score(): number {
    if (this.liveSecondsAcc === 0) return 100;
    return Math.min(100, this.smoothnessWeighted / this.liveSecondsAcc);
  }

  /** seconds is the accumulated driving time. */
  get seconds(): number {
    return this.secondsAcc;
  }

  /**
   * live is true once the rolling activity signal proves this is an actual
   * running, moving vehicle rather than a phone left motionless somewhere.
   * `score`'s accumulation requires this; `smoothness` (the instantaneous
   * reading) does not — it answers "how rough was whatever motion
   * happened", which stays a true statement (there was none) even while
   * this is false.
   */
  get live(): boolean {
    return this.activityEma >= LIVENESS_EPSILON;
  }

  /**
   * scoringEligible is the burstiness veto on top of `live`: once a trip
   * has run long enough for a duty cycle to mean anything, sparse rhythmic
   * activity (a faked tap, not a running engine) stops qualifying toward
   * `score`'s accumulation even though `live` — the UI's "is this a
   * vehicle at all" signal — stays true. See ACTIVITY_BURSTINESS_LIMIT
   * and SCORING_SETTLE_S.
   */
  private get scoringEligible(): boolean {
    if (this.secondsAcc < SCORING_SETTLE_S) return true;
    if (this.activityEma <= 0) return true; // nothing to divide by; live() already gates true stillness
    const variance = Math.max(0, this.activityPowerEma - this.activityEma * this.activityEma);
    const burstiness = variance / (this.activityEma * this.activityEma);
    return burstiness <= ACTIVITY_BURSTINESS_LIMIT;
  }

  private smoothnessNow(): number {
    const roughness = this.jerkEma + SUSTAINED_WEIGHT * this.dynEma;
    return Math.min(100, Math.max(0, 100 * (1 - roughness / BROWN_ROUGHNESS)));
  }

  /**
   * debugSnapshot exposes internal state for debug/capture.ts's per-sample
   * export — the "Export last drive" action on Settings. Diagnostic-only:
   * nothing in the engine's own behavior reads this back.
   */
  get debugSnapshot() {
    return {
      filteredMag: this.filteredMag,
      jerkEma: this.jerkEma,
      dynEma: this.dynEma,
      activityEma: this.activityEma,
      smoothness: this.smoothnessNow(),
      live: this.live,
    };
  }
}
