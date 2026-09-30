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
 * this engine is supposed to detect. v2 fixed this at the root — the
 * standard DSP answer to "real signal is slow, noise is fast, and I can't
 * sample fast enough to resolve the noise cleanly": low-pass the magnitude
 * *before* differencing it, then apply a small dead-band on top for whatever
 * the filter doesn't fully remove. That low-pass survives into v3 unchanged;
 * it's the frequency-domain half of the problem and was never what v2/v3
 * revisited.
 *
 * v2 judged jerk with a single EMA plus a slowly-adapting baseline (an
 * exponential moving average and "z-score" of its own recent history). Real
 * drives exposed three compounding problems with that shape, not separate
 * bugs so much as one bad fit: a bespoke, hand-tuned statistic standing in
 * for a much better-understood one. (1) A brand-new baseline starts at zero
 * and takes many seconds to become trustworthy, so every trip opened with a
 * false, unrepresentative dip. (2) Because the baseline adapts to *this
 * drive's own recent history*, a road that had already been rough for a
 * while raised the bar enough that a further genuinely sharp braking or
 * acceleration event could read as only mildly anomalous *for this drive* —
 * self-scaling with no floor to catch what it normalizes away. (3) A bare
 * EMA has no memory of its own: a harsh moment's effect on the *live number*
 * decayed about as fast as it appeared, reading as "it doesn't remember,"
 * and reacted to every sample-to-sample wiggle, reading as "jumpy."
 *
 * v3 replaces the single EMA with a *sliding-window RMS* (root mean square)
 * of jerk over two window lengths — the same shape ISO 2631 (the vibration/
 * ride-comfort standard used across automotive and rail engineering) uses
 * for exactly this class of problem: a frequency-weighted signal, then a
 * rolling RMS over a window, judged against comfort bands. A real window,
 * not an EMA approximating one, sidesteps all three v2 problems at once: it
 * is well-defined from literally the first sample (an RMS of "however much
 * data exists so far," not a cold-start blowup), it naturally *remembers* a
 * harsh moment for the length of the window as that moment ages out rather
 * than decaying the instant it ends, and it naturally *smooths* sample noise
 * the same way — no bespoke attack/release envelope needed on top. See
 * `SlidingRms`.
 *
 * Two window lengths, not one: SHORT_WINDOW_S ("what's happening right
 * now") compared against JERK_LONG_WINDOW_S ("what's been normal for this
 * road recently") — the short/long energy-ratio pattern standard in audio
 * and seismic onset detection for telling a transient apart from a shifting
 * baseline. This keeps v2's genuinely necessary property (the documented
 * "real motorway data sits at 0.4-0.9 g/s forever" case a fixed absolute
 * threshold alone cannot pass) without v2's fragility, because both windows
 * are well-behaved bounded aggregates, not a hand-fit EMA/spread pair.
 *
 * v3 tried, then deliberately dropped, a second *absolute* check on top of
 * the ratio — the tempting fix for "a sharp event can still hide behind an
 * already-elevated long window." It doesn't work here: real captures put
 * sustained, entirely benign motorway jerk RMS at 0.4-0.9 g/s, the same
 * range genuine harsh events reach, so any absolute ceiling loose enough to
 * leave that motorway reading alone is too loose to add anything on a rough
 * road, and any ceiling tight enough to help there flags ordinary highway
 * driving as permanently rough — reintroducing the exact bug the ratio
 * exists to fix. This is the ISO 2631 approach and DriveWell's diverging on
 * purpose: ISO 2631 measures absolute ride *exposure* (a rough road is
 * genuinely less comfortable, full stop), where DriveWell measures
 * road-relative driving *behavior* (how are *you* driving, on whatever road
 * this is) — those are different questions, and only the second one needs
 * self-scaling. The accepted, documented cost: on a road that's already
 * been rough for JERK_LONG_WINDOW_S, a further event needs to be
 * proportionally larger to register the same way it would on a smooth
 * road — the same "eventually reads as normal" tradeoff sustained roughness
 * already gets, just visible sooner. sustained gets no adaptation of any
 * kind: a steady g-force is a driver's choice — hard cornering,
 * trail-braking — not ambient texture, and must never be judged relative to
 * "what's normal," only against a fixed physical ceiling, smoothed over its
 * own short window for the same noise/memory reasons as jerk.
 *
 * Each path is its own fraction of "fully rough," and the raw, instantaneous
 * smoothness is the linear falloff from 100 at rest to 0 once those
 * fractions sum to 1. `smoothness` (what a driver actually watches live) is
 * exactly that raw value — the windowing above already gives it the
 * smoothing and memory v2 was missing, so no further shaping happens between
 * the roughness math and the screen.
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
 * A note on ambition: a plain accelerometer heuristic like this one is a
 * known-weak signal compared to what production telematics systems use —
 * Google's own research on phone-based hard-braking detection measured a
 * bare accelerometer heuristic at ~167x worse (by PR-AUC) than a model
 * fused with GPS speed and connected-vehicle sensors. DriveWell deliberately
 * has neither GPS nor a network connection nor a server-side model, by
 * design (see AGENTS.md's "deliberate simplifications") — this engine is
 * not trying to match that ceiling, only to be honest and useful within the
 * constraint of a phone's accelerometer alone. The constants below are
 * calibrated against four real drives' full-resolution captures (a
 * motorway cruise, a mixed-conditions route, and two more spanning a
 * highway and a rough country road), not just synthetic models — expect
 * further retuning as more real drives come in; they live here, and only
 * here, so that stays a one-file change.
 */

/** One accelerometer reading. x/y/z in g units; t is epoch milliseconds. */
export interface AccelSample {
  x: number;
  y: number;
  z: number;
  t: number;
}

/**
 * SlidingRms maintains the root-mean-square of a value over a trailing
 * time window, weighted by each sample's own Δt so it stays correct under
 * DriveWell's real, uneven accelerometer sample rate rather than assuming a
 * fixed Hz. A ring buffer, not an EMA approximation of one — see the module
 * doc for why that distinction is the whole point: it is well-behaved from
 * the very first sample (the RMS of however much data exists so far), with
 * no separate cold-start handling needed anywhere that uses it.
 */
class SlidingRms {
  private values: Float64Array;
  private dts: Float64Array;
  private head = 0;
  private count = 0;
  private sumSq = 0;
  private sumDt = 0;

  constructor(private readonly windowS: number, initialCapacity = 4096) {
    this.values = new Float64Array(initialCapacity);
    this.dts = new Float64Array(initialCapacity);
  }

  push(value: number, dt: number): void {
    if (this.count === this.values.length) this.grow();
    const tail = (this.head + this.count) % this.values.length;
    this.values[tail] = value;
    this.dts[tail] = dt;
    this.sumSq += value * value * dt;
    this.sumDt += dt;
    this.count++;

    while (this.count > 1 && this.sumDt > this.windowS) {
      const headValue = this.values[this.head]!;
      const headDt = this.dts[this.head]!;
      this.sumSq -= headValue * headValue * headDt;
      this.sumDt -= headDt;
      this.head = (this.head + 1) % this.values.length;
      this.count--;
    }
    // Repeated incremental subtract-on-evict, over thousands of samples in a
    // real trip, drifts sumSq/sumDt slightly negative from floating-point
    // rounding even though the true quantities they track never are —
    // clamping here (not just in the rms getter below) stops that drift
    // from compounding across the rest of the trip.
    if (this.sumSq < 0) this.sumSq = 0;
    if (this.sumDt < 0) this.sumDt = 0;
  }

  /** rms is 0 for an empty window — "no data yet" reads as "no roughness yet". */
  get rms(): number {
    return this.sumDt > 0 ? Math.sqrt(Math.max(0, this.sumSq) / this.sumDt) : 0;
  }

  private grow(): void {
    const newCapacity = this.values.length * 2;
    const newValues = new Float64Array(newCapacity);
    const newDts = new Float64Array(newCapacity);
    for (let i = 0; i < this.count; i++) {
      const idx = (this.head + i) % this.values.length;
      newValues[i] = this.values[idx]!;
      newDts[i] = this.dts[idx]!;
    }
    this.values = newValues;
    this.dts = newDts;
    this.head = 0;
  }
}

/**
 * Low-pass time constant applied to the raw magnitude before differencing,
 * seconds. ~1 Hz cutoff: strongly attenuates engine/road vibration (tens of
 * Hz, aliased or not) while barely touching real driving-force changes,
 * which unfold over roughly half a second or slower.
 */
const SIGNAL_TC_S = 0.15;

/**
 * Seconds of elapsed trip time before jerk (not sustained — see its use
 * below) is trusted enough to feed the RMS windows at all. A derivative
 * needs a handful of SIGNAL_TC_S's own time constants to stop reflecting
 * the low-pass filter settling in from a standing start rather than the
 * real signal; one sample's worth (as tried first) wasn't enough — the
 * *second* real derivative was still measurably transient too.
 */
const JERK_FILTER_SETTLE_S = 3 * SIGNAL_TC_S;

/** Residual filtered jerk below this (g/s) is sensor/mount noise, not driving. */
const JERK_FLOOR = 0.03;

/** Residual filtered sustained offset below this (g) is sensor/mount noise. */
const SUSTAINED_FLOOR = 0.02;

/**
 * Window length, seconds, for "what's happening right now" — both jerk's
 * short-term RMS and sustained's only window. Long enough to smooth genuine
 * per-sample sensor noise and give a real event some persistence after it
 * ends; short enough to still read as *current* rather than stale, and to
 * fully resolve the half-a-second-to-two-second events the module doc
 * describes real driving maneuvers as.
 */
const SHORT_WINDOW_S = 2.5;

/**
 * Window length, seconds, for jerk's long-term RMS — "what's been normal for
 * this road/speed recently," the same role BASELINE_TC_S played for v2's
 * EMA baseline, now a real window instead of an exponential approximation of
 * one. Long enough that a single real event (a few seconds, per
 * SHORT_WINDOW_S) barely moves it; short enough that genuinely sustained
 * roughness (this window's-worth or more) gradually reads as normal — the
 * same accepted "eventually forgiven" tradeoff v2 had, now expressed over a
 * concrete window rather than a decay rate.
 */
const JERK_LONG_WINDOW_S = 30;

/**
 * The short/long jerk RMS ratio at and above which smoothness is 0 on this
 * path alone. Confirmed against a real motorway capture where jerk RMS sat
 * at a steady 0.4-0.9 g/s for the entire cruise: short and long windows
 * converge to nearly the same value there, keeping the ratio near 1
 * regardless of that road's absolute noise level — this is what lets the
 * same threshold work on a glassy new road and a washboard gravel one
 * without retuning.
 */
const JERK_RATIO_CEILING = 3.5;

/**
 * Minimum assumed long-window jerk RMS (g/s), floors JERK_RATIO_CEILING's
 * denominator. Without this, the first fraction of a second of any trip —
 * before the long window has any real data — would make even ordinary
 * sensor noise look like an infinite ratio above "normal". Same role
 * JERK_FLOOR plays one stage earlier, at the RMS-ratio stage instead of the
 * raw-signal stage.
 */
const JERK_LONG_RMS_FLOOR = 0.04;

/**
 * Seconds of assumed-quiet virtual history the long window starts seeded
 * with — see SmoothnessEngine.seededLongRms's own comment for why. A third
 * of JERK_LONG_WINDOW_S: long enough that a genuinely harsh trip-opening
 * clearly contrasts against it, short enough that real ambient texture (a
 * road that's simply always been this way) fully displaces it well within
 * the long window's own length rather than lingering as a stale assumption.
 */
const JERK_LONG_RMS_SEED_S = 15;

/**
 * Sustained roughness units (SUSTAINED_WEIGHT × sustained RMS) at and above
 * which smoothness is 0 on the sustained path alone. sustained has no
 * baseline or long window — a steady g-force is a driver's choice, not road
 * texture, and must never be judged relative to "what's normal," only
 * against this fixed physical ceiling (unchanged from earlier calibrations:
 * roughly 0.67 g of sustained deviation, held for SHORT_WINDOW_S, is enough
 * to tank it on its own).
 */
const SUSTAINED_ROUGHNESS_CEILING = 2.0;

/** How many g/s-equivalent of sustained RMS equals 1 g/s of jerk, penalty-wise. */
const SUSTAINED_WEIGHT = 3;

/**
 * Rolling time constant, seconds, for the liveness-activity EMA. Long
 * enough to ride through an ordinary traffic stop with the engine idling
 * (~30 s of grace) without pausing score accumulation; short enough that a
 * phone genuinely abandoned mid-trip stops contributing within under a
 * minute rather than indefinitely.
 */
const ACTIVITY_TC_S = 8;

/**
 * The liveness-activity EMA must clear this (g or g/s) before score
 * accumulates. Set far below any real vehicle's vibration (which clears it
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
 * A silence in the sensor stream longer than this (seconds) is a hole, not
 * slow sampling — in practice the app being in the background, which Android
 * answers by delivering no accelerometer events at all. The trip's wall-clock
 * time still advances across it (the drive really did take that long), but
 * nothing is scored across it, and the low-pass filter is re-seeded rather
 * than differenced against a reading from minutes ago.
 */
const MAX_SAMPLE_GAP_S = 1;

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
  private jerkShortRms = new SlidingRms(SHORT_WINDOW_S);
  private jerkLongRms = SmoothnessEngine.seededLongRms();
  private sustainedRms = new SlidingRms(SHORT_WINDOW_S);
  private activityEma = 0;
  private activityPowerEma = 0;
  private smoothnessWeighted = 0;
  private secondsAcc = 0;
  private liveSecondsAcc = 0;

  /**
   * The long window starts seeded with JERK_LONG_RMS_SEED_S of assumed-quiet
   * virtual history rather than empty. An empty long window is
   * indistinguishable from the short window for as long as they've only ever
   * seen the same handful of real samples — meaning a trip that's harsh from
   * its very first second has no established "normal" to read as anomalous
   * against, and reads as smooth. Seeding with quiet assumes a trip starts
   * from rest (true for the overwhelming majority of real drives — pulling
   * away from a parked, stationary position), giving early harshness
   * something real to contrast against; it costs nothing once the seed ages
   * out of the window over the seed's own length.
   */
  private static seededLongRms(): SlidingRms {
    const rms = new SlidingRms(JERK_LONG_WINDOW_S);
    rms.push(JERK_LONG_RMS_FLOOR, JERK_LONG_RMS_SEED_S);
    return rms;
  }

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
    if (dt > MAX_SAMPLE_GAP_S) {
      this.filteredMag = mag;
      this.lastT = s.t;
      this.secondsAcc += dt;
      return;
    }

    const prevFiltered = this.filteredMag;
    const filterAlpha = dt / (SIGNAL_TC_S + dt);
    this.filteredMag = prevFiltered + filterAlpha * (mag - prevFiltered);

    const jerkRaw = Math.abs(this.filteredMag - prevFiltered) / dt;
    const sustainedRaw = Math.abs(this.filteredMag - GRAVITY_G);
    const jerk = Math.max(0, jerkRaw - JERK_FLOOR);
    const sustained = Math.max(0, sustainedRaw - SUSTAINED_FLOOR);

    // The first few jerk computations difference against a filteredMag
    // that hasn't converged yet (the very first one differences against the
    // first raw sample, unfiltered — there was no prior filtered value to
    // low-pass against at all) — SIGNAL_TC_S's own settling transient, not
    // a real reading. Feeding it into the still-nearly-empty short (or
    // long) window would let it dominate the RMS for a while, biasing the
    // very start of every trip. Needs a few time constants, not just one
    // sample, to genuinely settle. sustained isn't a derivative, so it
    // doesn't have this problem and always counts.
    const jerkFilterSettled = this.secondsAcc >= JERK_FILTER_SETTLE_S;
    if (jerkFilterSettled) {
      this.jerkShortRms.push(jerk, dt);
    }
    this.sustainedRms.push(sustained, dt);

    const activityLevel = Math.max(jerkRaw, sustainedRaw);
    // Gated on *this instant's* raw activity, not the hysteretic `live`
    // getter below. `live` is deliberately sticky — it stays true for a
    // grace period after a real stop so a red light doesn't pause score
    // accumulation — but that stickiness is wrong here: a stop longer than
    // JERK_LONG_WINDOW_S would otherwise fill the entire long window with
    // zeros, erasing what it knew about the road before the very next
    // stretch of driving even starts (confirmed by a test built for exactly
    // this: "the jerk baseline survives a stop instead of resetting").
    // Gating on the instantaneous level instead freezes the long window the
    // moment real activity actually stops, not up to ~30s later.
    if (jerkFilterSettled && activityLevel >= LIVENESS_EPSILON) {
      this.jerkLongRms.push(jerk, dt);
    }

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

  /**
   * smoothness is the live display reading, 0-100, rounded. The sliding
   * windows behind it already provide smoothing and a few seconds of
   * memory after a harsh event (see the module doc) — no further shaping
   * happens between the roughness math and this getter.
   */
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

  /** seconds is the accumulated driving time — total wall-clock, including any non-live stretches. */
  get seconds(): number {
    return this.secondsAcc;
  }

  /**
   * liveSeconds is the subset of `seconds` proven live (see `score`) — a
   * trip that's all idle stillness (a phone left on a table) has `seconds`
   * but no `liveSeconds`, which is what a caller should check before
   * deciding a trip is worth saving at all, not just whether it was long.
   */
  get liveSeconds(): number {
    return this.liveSecondsAcc;
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
    const shortJerk = this.jerkShortRms.rms;
    const longJerk = Math.max(this.jerkLongRms.rms, JERK_LONG_RMS_FLOOR);
    const ratio = shortJerk / longJerk;
    const jerkRoughness = Math.max(0, ratio - 1) / (JERK_RATIO_CEILING - 1);
    const roughness = jerkRoughness + (SUSTAINED_WEIGHT * this.sustainedRms.rms) / SUSTAINED_ROUGHNESS_CEILING;
    return Math.min(100, Math.max(0, 100 * (1 - roughness)));
  }

  /**
   * debugSnapshot exposes internal state for debug/capture.ts's per-sample
   * export — the "Export last drive" action on Settings. Diagnostic-only:
   * nothing in the engine's own behavior reads this back.
   */
  get debugSnapshot() {
    return {
      filteredMag: this.filteredMag,
      jerkShortRms: this.jerkShortRms.rms,
      jerkLongRms: this.jerkLongRms.rms,
      sustainedRms: this.sustainedRms.rms,
      activityEma: this.activityEma,
      smoothness: this.smoothnessNow(),
      live: this.live,
    };
  }
}
