# Scoring algorithm fix + points→percentage redesign

Status: approved in chat, pending written-spec review.

## Background

Real-world validation (two motorway drives, ~5.5 min and ~15 min, captured via
Settings' "Export last drive") revealed that `SmoothnessEngine` scores ordinary,
careful highway driving at 70-78% and never recovers toward 100 — even with no
harsh braking, acceleration, or cornering happening. Analysis of the captured data
confirmed the root cause and validated a fix (see "Scoring algorithm fix" below).

Separately, the points system needs a UX rework: points accrue too fast to feel
meaningful, and showing both a point total and a percentage at trip-end is
confusing. Both changes land together because the scoring fix changes what the
headline `score` number means, and the percentage redesign makes `score` the
*only* headline number — so they need to be designed as one coherent change to
`SmoothnessEngine`'s public surface.

## Scoring algorithm fix

### Diagnosis (from real data)

- `jerkEma` accounted for ~90% of `roughness` throughout both drives (vs. ~10%
  from `dynEma`/sustained).
- `jerkEma` sat at a **steady 0.4-0.5 g/s for the entire cruise** — 15x
  `JERK_FLOOR` (0.03) — with low relative variance (CV 10-20%): genuinely
  continuous ambient vibration, not sporadic events.
- Measured vibration oscillation frequency: **2.3-3.5 Hz** (via zero-crossing
  analysis of `filteredMag`). This is close enough to the ~0.5-2 Hz band the
  original design attributes to real driving inputs that a simple low-pass
  cannot cleanly separate them by frequency alone — confirmed empirically: the
  single largest jerk excursion in either drive peaked only 40-80% above the
  *ambient* median, leaving no headroom between "road noise" and "the roughest
  moment of otherwise careful driving."
- `dynEma` (sustained) stayed low (0.01-0.04) throughout — it is *not* part of
  the problem and needs no change.

### The fix: an adaptive jerk baseline

The signal that actually separates ambient vibration from a real driving event
is not oscillation frequency (only ~2-3x separation, too little to filter on)
but **persistence duration** of the already-smoothed `jerkEma` signal: ambient
vibration keeps `jerkEma` elevated for the entire drive (minutes), while a real
event elevates it for a few seconds at most — a 100x+ separation.

Track a second-stage EMA of `jerkEma` itself, with a much longer time constant,
representing "what's been normal for this road/speed recently." Score only the
*excess* above that baseline:

```
JERK_BASELINE_TC_S = 20   // first-pass guess; expect to retune, like every
                          // other constant in this file
...
this.jerkBaseline += baselineAlpha * (this.jerkEma - this.jerkBaseline);
const excessJerk = Math.max(0, this.jerkEma - this.jerkBaseline);
const roughness = excessJerk + SUSTAINED_WEIGHT * this.dynEma;  // dynEma path unchanged
```

`jerkBaseline` initializes to the first computed `jerkEma` value (not 0), the
same pattern `filteredMag` already uses, to avoid a fake initial transient.

Validated by replaying this exact transform against both captured drives using
the existing `BROWN_ROUGHNESS = 2.0` (no change needed there):

| | Current (fixed floor) | Adaptive baseline (TC=15s, simulated) |
|---|---|---|
| Mean smoothness | 74-78% | 94-97% |
| p10 (still shows real dips) | 68-75% | 89-93% |

TC=20s is chosen as a middle point between the tested 15s (best mean/p10, but
forgives sustained harshness fastest) and 30s+ (slower to forgive, slower to
adapt to a road/speed change) — a first-pass compromise, not empirically
optimal; retune against more real drives.

### Explicit, accepted tradeoff

An adaptive baseline is very good at rejecting *constant* ambient noise, but it
also means genuinely sustained harsh driving — aggressive inputs held
continuously for longer than the baseline's own ~20s time constant, not a
single hard brake or corner — gradually gets absorbed into the new "normal"
and stops being penalized as much. This is a real, narrower failure mode than
today's, which fails on *every* highway drive regardless of quality. Accepted
knowingly, not a gap to silently revisit.

### Consequence for trip start

For the first ~20-40s of every trip, before `jerkBaseline` has caught up,
smoothness reads at whatever the current ambient level implies (same as
today's behavior), then recovers once the baseline settles. This is an
expected characteristic of the fix, not a new bug — similar in kind to the
existing `EMA_TC_S` warm-up already present in `jerkEma` itself.

### Testing

- `scoring.test.ts` needs a new synthetic fixture modeling *continuous*
  ambient vibration (not the existing single-cycle `driving()` dither, which
  is already continuous but at too-small an amplitude to have exercised this
  bug) at a magnitude matching the real data (jerk ~0.4-0.5 g/s, steady),
  proving smoothness recovers toward 100 after the baseline settles.
- Existing panic-stop (`rampAndHold`) and vibration-tolerance tests must still
  pass, possibly with retuned expected ranges — a real behavior change to
  those thresholds is expected and fine; the underlying invariants ("a
  genuine harsh brake still tanks the score", "vibration degrades gracefully")
  must still hold.
- A new test proving the accepted tradeoff itself: driving harshly and
  *continuously* for well beyond `JERK_BASELINE_TC_S` eventually stops being
  penalized as much — documents the tradeoff in the test suite rather than
  leaving it implicit.

## Points → percentage redesign

### Data model

- `Trip.points` is removed entirely. `SmoothnessEngine` drops `points`,
  `pointsAcc`, `POINTS_PER_SECOND`, `pointsEligible`, `GREEN_THRESHOLD` (it
  only ever gated point accrual; nothing else references it).
- `SmoothnessEngine` keeps exactly two headline numbers: `smoothness`
  (instantaneous %, unchanged) and `score` (accumulated %, same meaning —
  time-weighted average — but see next section for a fix to its weighting).

### `score` now requires liveness

Today `score` accumulates through non-live time too — a phone forgotten
running after parking pads the trip average with "perfect" idle smoothness,
diluting how rough the actual driving was. This was flagged in the original
algorithm review and matters more now that `score` is the only headline
number. Fix: only accumulate `smoothnessWeighted` (and its own seconds
denominator) during live time, reusing the existing hardened
liveness/burstiness gate (previously gating points, now repurposed to gate
"what counts as real driving"). `seconds` ("Elapsed" on the Drive screen)
stays total wall-clock time, unaffected — only `score`'s own weighting
excludes non-live stretches.

### Storage migration

The SQLite `trips` table has `points INTEGER NOT NULL` with no default.
Dropping it from the code without a migration makes the very next `putTrip`
against any existing on-device database throw a NOT NULL constraint
violation — a real crash-shaped bug. `SqliteStore.open()` gets a real
`ALTER TABLE trips DROP COLUMN points` migration, checked via
`PRAGMA table_info` so it's a no-op on fresh installs. A new case in
`storeContract.ts` (per AGENTS.md: storage behavior belongs there, not in
`SqliteStore`'s own test file) opens a store against a pre-seeded old-schema
database and proves it still works.

### UI changes

- **Drive screen**: drop "Points this drive" — the live smoothness % already
  covers "instantaneous." Idle state's "Lifetime points" tile becomes
  "Lifetime average" (`computeStats.averageScore`). Last-trip summary drops
  the "+N pts" suffix, shows only the score. The personal-best milestone
  toast is unaffected (already keyed off `trip.score`, never `points`).
- **Stats screen**: drop the "Lifetime points" metric tile (4 remaining
  metrics still fill the grid). Fix `improvementText`'s pre-existing
  mislabeling — it says "Up N points" but `improvement` was always a score
  delta, never the app's points currency.
- **Settings screen**: reword "you start earning points" to describe the
  percentage instead.

### Testing

- `scoring.test.ts`: every points-related test gets rewritten around `score`/
  live-seconds gating instead of `points` accrual, preserving the underlying
  behavior each test protects (liveness detection speed, grace period,
  tap-cheese resistance) — not just deleted.
- `stats.test.ts`: remove `totalPoints` assertions/field.
- `Drive.test.tsx`, `Stats.test.tsx`, `Settings.test.tsx`: update to the new
  copy/layout; assert behavior, not snapshots, per AGENTS.md.
- `storeContract.ts`: add the schema-migration case described above.

## Out of scope

- Any further rework of the "Export last drive" feature (shipped in
  beta.5) — this spec only consumes the data it already proved useful for.
- GPS/speed-based approaches to the scoring problem — ruled out by the app's
  existing no-GPS, no-network design stance, unrelated to this fix.
