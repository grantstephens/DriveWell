# DriveWell — Agent guidance

This file provides guidance to coding agents (Claude Code, pi, etc.) when working in
this repository.

## What this is

An offline driving-smoothness trainer (React Native + Expo). Drive with the app open;
it reads the accelerometer, scores how jerky the drive is, and shows a leaf that turns
from brown to green as the driving smooths out, with a percentage score shown live.
Android is the only shipping target — there is no accelerometer to read in a browser
tab, so unlike some sibling projects this one carries no web target, no `react-native-web`,
and no IndexedDB storage backend.

This project's scaffolding (build tooling, F-Droid recipe, release workflow, project
layout conventions) was adapted from the sibling project ReminDiary, which has already
been through real F-Droid submission review — see that repository's own `AGENTS.md` and
`fdroid/` recipe for the reasoning behind mechanics like the reproducible-build gradle
patches, the per-ABI split, and `fdroid-version.txt`. Nothing here should silently
diverge from those proven mechanics without a reason specific to DriveWell.

## Expo version

This project targets Expo SDK **57**. Read the exact versioned docs at
https://docs.expo.dev/versions/v57.0.0/ before writing any code that uses Expo APIs.

## The toolchain

Pinned in [`mise.toml`](mise.toml) — `mise install` after cloning. Install tools through
`mise`, not a system package manager or a global `npm -g`.

## Commands

```bash
make check          # tsc --noEmit && jest — the gate before any commit
make test           # jest
make start          # Expo dev server; scan the QR code with Expo Go
make android        # Expo dev server, opening on a connected device
```

Or without `make`:

```bash
npm run check
npx jest src/domain/scoring.test.ts   # single test file
```

## Architecture

Layered, dependencies pointing inward. `src/screens` depends on `src/domain`;
`SqliteStore` implements `src/domain`'s `Store`; nothing imports from `src/screens`
except `App.tsx`.

| Directory | Role |
|---|---|
| `src/domain` | Domain only: the `SmoothnessEngine` (accelerometer samples in, a live score out), `DriveBreakdown` (the end-of-drive braking/cornering/acceleration traffic lights) and `formatShareText` (the Wordle-style share card), `leafColor`, `Trip`, the `Store` interface, `computeStats`, and duration formatting. Imports nothing external — no React, no Expo — which is why it runs in a plain Node Jest environment. |
| `src/storage` | `SqliteStore` (via `expo-sqlite`/`node:sqlite`), held to a behavioural contract (`storeContract.ts`) so the device implementation can never drift from what the tests actually exercise. |
| `src/screens` | Drive (the leaf), Stats, Settings. |
| `src/platform` | The one thing that genuinely differs per build: the motion sensors (`motion.*` — the accelerometer, plus the gyroscope where the phone has one, delivered as one sample stream) and the confirm/alert dialog (`confirm.*`, native-only by design — there is no web target to branch on). |
| `src/components/TrafficLights.tsx` | The three end-of-drive lights (braking, cornering, acceleration). Real traffic-light colours, deliberately not theme colours, for the same reason the leaf isn't themed. |
| `src/components/Leaf.tsx` | The leaf's artwork: `MaterialIcons`'s "eco" glyph, tinted by the caller, plus an SVG radial-gradient glow that intensifies with smoothness². Every color decision lives in `domain/leaf.ts` — this component only draws it, entirely independent of the app's own Material theme below (the leaf communicates driving quality, not brand identity). |
| `src/theme.ts` | The whole app's Material Design 3 theme (`react-native-paper`), generated from one seed color — the leaf's own lush-green stop — via `@material/material-color-utilities` (Google's pure-JS MD3 color algorithm; deliberately not a package that bundles native code for *system* wallpaper theming, which this app has no use for). Every screen reads colors through `useTheme()` from `react-native-paper`, not a custom context — there is no `ThemeContext.tsx`. |
| `App.tsx` / `DriveContext.tsx` | `PaperProvider` + a Material 3 bottom navigation bar (`BottomNavigation.Bar`, the documented react-native-paper/react-navigation integration pattern) bootstrapped from `useColorScheme()` directly — no stored override, see "Deliberate simplifications" below. Also: store bootstrap, the error screen, and the `revision` counter every write path bumps so Stats and the Drive screen's lifetime-average readout stay in sync. |

### Deliberate simplifications versus the ReminDiary template this was adapted from

1. **No web target.** The accelerometer is the entire premise; a browser tab on a
   laptop has nothing meaningful to score. This removes `react-native-web`, the
   `IndexedDbStore` backend, and any `Platform.OS === 'web'` branching from the
   `openStore` pattern ReminDiary uses.
2. **No stored theme preference.** The app follows the system color scheme and nothing
   else — one fewer persisted file, one fewer settings control, for a screen you glance
   at while driving rather than sit inside.
3. **No CSV export/import.** There is nothing to reconcile across devices; a trip
   history is small, and losing it on uninstall is an accepted tradeoff stated plainly
   in the README, not a gap to fill in later.

### Invariants worth not breaking

- **Trip timestamps are RFC3339 UTC with no fractional seconds** (`domain/timestamp.ts`,
  `formatTimestamp`). `startedAt` is the store's primary key — lexicographic order on it
  is chronological order, which is why `SqliteStore.trips()` needs no secondary index.
- **Scoring is orientation-independent by construction.** `SmoothnessEngine` works off
  the accelerometer reading's total magnitude (`Math.hypot(x, y, z)`), never a single
  axis, specifically so it doesn't matter where in the car the phone is mounted. Do not
  reintroduce axis-specific logic without re-deriving this property.
- **`DriveBreakdown` is the one axis-aware component, and it is kept apart on purpose.**
  Telling braking from cornering needs to know which way is forward, so it works the
  car's axes out *from the drive itself* (gravity → horizontal plane → the gyroscope's
  yaw rate identifies sideways, forward follows by the right-hand rule; principal-component
  analysis as a one-sensor fallback that answers "unknown" rather than guess when the axes
  are ambiguous). It only feeds the end-of-drive card and never the live score. It is
  validated by synthetic drives rotated into arbitrary phone orientations; **the gyro
  path has not yet been validated against a real drive** (the debug export logs gyro
  now, precisely so it can be) — check the braking-vs-acceleration sign convention
  against real captures before trusting it.
- **Holes in the sensor stream are not driving.** Android stops delivering accelerometer
  and gyroscope events to an app that is not in the foreground (Android 9+), so a driver
  who switches to a navigation app leaves DriveWell blind — a real 17-minute drive had
  ~9 minutes of holes (145 s, 193 s, 213 s). `SmoothnessEngine` treats any `MAX_SAMPLE_GAP_S`
  silence as a hole: wall-clock `seconds` advances, but nothing is scored across it and the
  filter re-seeds (before this, that 17-minute drive reported 826 s of "live" time from ~464 s
  of data). `DriveBreakdown` likewise rates on active time, and additionally ignores
  `POST_GAP_SETTLE_S` after a hole and any moment the gyroscope shows the phone tumbling
  about a horizontal axis (`HANDLING_RAD_S`) — a car body barely rolls or pitches, so that
  is the phone being picked up. Its gravity comes from a rolling median over the whole
  drive, not an online estimate: an online low-pass took a minute to converge after the
  phone was mounted, and its tilt error read as ~0.16 g of phantom acceleration. Real
  gyro logs also show the gyroscope delivering ~12.5 Hz, not the 50 Hz requested; fine for
  yaw smoothed over 0.5 s.
- **The breakdown is not persisted.** It is only needed for the drive that just ended
  (the share card), so `Trip` and the schema are untouched. Sharing goes through React
  Native's built-in `Share` (plain text), so there is no new native dependency.
- **The raw magnitude is low-pass filtered *before* differencing, never read
  directly.** A phone in a moving car picks up engine/road vibration in the
  tens-of-Hz range; sampled at ~10-50 Hz that aliases into false jerk
  indistinguishable from real harsh driving (a real regression — see
  `domain/scoring.ts`'s module doc for the full story). Filtering the
  magnitude before differencing, plus a small noise-floor dead-band on top,
  is what lets ordinary road/engine vibration stay green while genuinely
  harsh events still tank the score. The calibration constants are
  first-pass physics-based guesses, not tuned against real drives, and are
  deliberately concentrated in that one file so tuning stays a one-file
  change.
- **`score`'s accumulation requires `SmoothnessEngine.live`, not just a low
  roughness.** An accelerometer cannot distinguish "parked" from "cruising
  at a constant velocity" — both are zero acceleration (Newton's first
  law), so without a separate check a phone left motionless on a table
  would score identically to the smoothest drive imaginable, padding a
  rough trip's average with "perfect" idle time. `live` is a
  much-faster-tripping, much-lower-threshold rolling EMA of the *raw*
  (unfloored) jerk/sustained signal — the same "any real vehicle vibrates"
  fact the roughness score spends its effort filtering *out* is exactly
  what proves a phone is actually in a moving, running vehicle.
  `smoothness` (the instantaneous reading) stays true regardless of `live`
  ("no roughness was detected" is honest even when nothing is proven);
  only `score`'s accumulation gates on it, alongside a burstiness veto once
  a trip has run long enough (`SCORING_SETTLE_S`) that stops sparse,
  rhythmic activity (a faked tap, not a running engine) from counting even
  though `live` stays true. See the "the liveness gate" describe block in
  `scoring.test.ts` for the exact behavior, including the bounded grace
  period that keeps an ordinary traffic stop from pausing accumulation, and
  the long jerk window (below) freezing rather than filling with zeros while not active.
- **Jerk is scored by a short-window/long-window RMS ratio, not a fixed floor or an
  absolute ceiling.** Real motorway vibration (measured 2.3-3.5 Hz) sits too close to
  the driving-event frequency band for a low-pass filter alone to reject it — captured
  highway data showed jerk sitting at a steady 0.4-0.9 g/s for an entire cruise, 15x
  `JERK_FLOOR`, the same range genuine harsh events reach. So `SmoothnessEngine` compares
  the last `SHORT_WINDOW_S` of jerk (sliding-window RMS, `SlidingRms` — a real ring
  buffer, not an EMA) against the last `JERK_LONG_WINDOW_S`, and only the excess counts.
  A real window is well-defined from the first sample and naturally smooths noise and
  remembers a harsh moment for a few seconds; this replaced an EMA-plus-adaptive-baseline
  design whose fresh baseline started at zero (false early dips), which could silently
  absorb a sharp event on a road that was already rough, and which forgot an event
  almost as fast as it happened. **An absolute-ceiling "escape hatch" was tried and
  deliberately dropped**: any ceiling loose enough to leave that motorway alone is too
  loose to catch anything on a rough road, and any tighter one flags ordinary highway
  driving as permanently rough. Accepted, documented tradeoff: on a road that's already
  been rough for `JERK_LONG_WINDOW_S`, a further event must be proportionally larger to
  register. The long window is fed only while there is *instantaneous* activity (not the
  sticky `live` flag), so a stop longer than the window can't erase what it knew about
  the road, and it starts seeded with `JERK_LONG_RMS_SEED_S` of assumed-quiet history so a
  drive that is harsh from its first second still has something to contrast against.
  Jerk from the first `JERK_FILTER_SETTLE_S` is ignored (the low-pass filter's own
  settling transient). See `domain/scoring.ts`'s module doc for the full derivation.
- **`score` and `smoothness` getters are read-only derived state.** Nothing
  outside `SmoothnessEngine` mutates the running averages; a screen just pushes samples
  and reads the getters after each one.
- **A drive is discarded, not saved, unless it clears both `MIN_TRIP_SECONDS` of
  wall-clock duration *and* of proven-live time** (`domain/trip.ts`'s
  `isDriveWorthSaving`). The live-time half matters specifically because a phone left on
  a table racks up wall-clock seconds without ever proving a vehicle was involved — it
  must not be saved as a trip, let alone one reporting a suspicious, unearned 100% now
  that `score` requires liveness. This is deliberately part of the domain layer, not
  screen-level UI logic, since "was this actually a drive" is a fact about the trip, not
  about how a button was drawn.
- **Stats are always derived, never stored.** `computeStats(trips)` from the trip list
  alone, same rule ReminDiary's `computeStats` follows for the same reason: it rules out
  a whole class of cache-invalidation bugs.
- **Nothing crashes on a user's device.** `Store` methods reject with errors, and a
  missing accelerometer surfaces as a `notify()` dialog from the Drive screen, not an
  unhandled rejection. A failed database open renders an error screen, not a blank app.
- **Android ships exactly one permission: `INTERNET`, unused.** `app.json` sets
  `android.permissions: []`, but `expo-sensors` still contributes
  `ACTIVITY_RECOGNITION` (for its `Pedometer`, which this app never imports) at
  prebuild time regardless — along with the handful of permissions the Expo/RN
  templates themselves inject (`BODY_SENSORS`, `HIGH_SAMPLING_RATE_SENSORS`,
  `READ_EXTERNAL_STORAGE`, `SYSTEM_ALERT_WINDOW`, `VIBRATE`,
  `WRITE_EXTERNAL_STORAGE`). All of them are listed in `android.blockedPermissions`.
  `INTERNET` is left unblocked only because the RN template's own main manifest
  declares it unconditionally and nothing in the app ever calls it — verify any real
  build with `aapt dump permissions <apk>`, or `grep uses-permission` against
  `android/app/src/main/AndroidManifest.xml` after `expo prebuild` (`tools:node="remove"`
  is the correct merge directive; only Gradle's manifest merger actually applies it).
- Out of scope by design: GPS/location, trip routing or maps, background scoring while
  the app is not open, social features, notifications.

### Testing gotchas specific to this stack

- **In screen tests, `await` every `fireEvent` that changes state, and `await render`.**
  With this project's versions of `react`/`react-test-renderer`/`@testing-library/react-native`,
  an un-awaited `fireEvent` overlaps the `act()` scope of whatever follows it and
  corrupts React's act bookkeeping — every later `render()` in that file then silently
  produces an **empty tree**, surfacing as confusing "element not found" failures
  unrelated to the component under test.
- **Never compare a rounded getter (`smoothness`, `score`) across two moments with
  strict equality when the raw accumulation is still converging.** The getter is rounded
  for display; the true rate can be exactly right while two roundings a few seconds
  apart land ±1 apart purely from where each side's fraction happens to fall. Assert a
  tolerant range instead, and say why in the comment.
- **A hand-typed unit-vector constant is not exact.** `0.577` is not `1/√3`; feeding it
  into `Math.hypot` produces a real, non-negligible magnitude error, not a floating-point
  edge case. Use `1 / Math.sqrt(3)` when a test needs an exact-magnitude diagonal
  orientation.
- **A class instance cannot be spread to build a partial fake.** `{ ...store, get: fn }`
  copies only own enumerable fields, not prototype methods, so a `SqliteStore`'s other
  methods come back `undefined` at runtime while type-checking fine. Bind explicitly per
  method instead.
- **`@material/material-color-utilities` is ESM-only.** `jest-expo`'s default
  `transformIgnorePatterns` doesn't cover it, so any screen test importing
  `../theme` (for `lightTheme`, e.g. to wrap a render in `PaperProvider`) fails
  at require time with "Must use import to load ES Module" unless the
  `screens` project's `transformIgnorePatterns` in `jest.config.js`
  allowlists it — already done; don't remove that entry.

## Testing

TDD throughout: failing test first, watch it fail, then implement.

- `src/domain` — table-driven pure logic: synthetic accelerometer streams for the
  scoring engine (orientation independence, braking events, EMA recovery, time-weighted
  averaging), stop interpolation, trend-window edge cases in stats.
- `src/storage` — add cases to the shared `storeContract.ts`, never to `SqliteStore`'s
  own test file; that is what stops a future second backend from diverging.
- `src/screens` — React Native Testing Library; assert behaviour (which button shows,
  what got persisted, whether the leaf's fill actually changed), not snapshots.

## Data

The database is `drivewell.db`, `SqliteStore` via `expo-sqlite`. Uninstalling the app
deletes it — stated plainly in the README, not a gap to silently fix later.

## Assets

The app icon is a single flat leaf silhouette — solid colors, no gradients or blurred
drop shadows, so it stays crisp at small sizes and through Android's adaptive-icon
squircle crop. `assets/icon.svg` is the editable source (full-bleed, artwork centered in
the safe zone); `assets/icon-foreground.svg` and `assets/icon-monochrome.svg` are the
split layers Android's adaptive icon needs — the background is a flat `backgroundColor`
in `app.json`, not an image.

Regenerate every raster asset from the three source SVGs after any artwork change:

```bash
cd assets
rsvg-convert -w 1024 -h 1024 icon.svg -o icon.png
rsvg-convert -w 1024 -h 1024 icon.svg -o splash-icon.png
rsvg-convert -w 1024 -h 1024 icon-foreground.svg -o android-icon-foreground.png
rsvg-convert -w 1024 -h 1024 icon-monochrome.svg -o android-icon-monochrome.png
rsvg-convert -w 48 -h 48 icon.svg -o favicon.png
rsvg-convert -w 512 -h 512 icon.svg -o ../fastlane/metadata/android/en-US/images/icon.png
```

The last file is F-Droid-specific: fdroidserver's `insert_localized_app_metadata()` reads
`fastlane/metadata/android/<locale>/images/icon.png` as a dedicated high-resolution icon
separate from whatever it extracts from the APK itself — without it, F-Droid falls back
to an APK-extracted, density-capped icon and upscales that for the app's detail page.

## Releasing

Pushing a `v*` tag triggers `.github/workflows/release.yml`, which builds a signed APK
and AAB and attaches them to a GitHub Release. `versionCode` is packed from the tag
itself (see `tools/compute-version.sh`).

Before tagging, run `make prepare-release TAG=v1.0.1 CHANGELOG=path/to/notes.txt`. It
computes the version, writes it into `fdroid-version.txt`, and copies your notes into
`fastlane/metadata/android/en-US/changelogs/<versionCode>.txt` for both split APKs'
versionCodes. Both files must exist *in the tagged commit*: F-Droid's `AutoUpdateMode`
reads Fastlane metadata from the exact commit a release tag points at, not from `main`
afterward. Then tag and push as the command's output instructs.

`fdroid/xyz.hub13.drivewell.yml` has no live `Builds:` entries yet — there has been no
release to point them at. It carries a commented, `TODO`-marked template adapted from
ReminDiary's proven recipe; fill it in once v1.0.0 is tagged and its split APKs are
published, following the comments in that file.

Android identifies the app by its signing certificate — keep `drivewell.keystore` (not
committed) backed up and use the same key for every release.
