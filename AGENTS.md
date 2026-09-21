# DriveWell — Agent guidance

This file provides guidance to coding agents (Claude Code, pi, etc.) when working in
this repository.

## What this is

An offline driving-smoothness trainer (React Native + Expo). Drive with the app open;
it reads the accelerometer, scores how jerky the drive is, and shows a leaf that turns
from brown to green as the driving smooths out. Once the leaf is green, points accrue.
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
| `src/domain` | Domain only: the `SmoothnessEngine` (accelerometer samples in, a live score out), `leafColor`, `Trip`, the `Store` interface, `computeStats`, and duration formatting. Imports nothing external — no React, no Expo — which is why it runs in a plain Node Jest environment. |
| `src/storage` | `SqliteStore` (via `expo-sqlite`/`node:sqlite`), held to a behavioural contract (`storeContract.ts`) so the device implementation can never drift from what the tests actually exercise. |
| `src/screens` | Drive (the leaf), Stats, Settings. |
| `src/platform` | The one thing that genuinely differs per build: the accelerometer (`motion.*`) and the confirm/alert dialog (`confirm.*`, native-only by design — there is no web target to branch on). |
| `src/components/Leaf.tsx` | The leaf's SVG silhouette. Purely presentational — every color decision lives in `domain/leaf.ts`. |
| `src/theme.ts`, `src/ThemeContext.tsx` | Light/dark palettes; `ThemeProvider` follows the system color scheme only. There is no stored override — see "Deliberate simplifications" below. |
| `App.tsx` / `DriveContext.tsx` | Store bootstrap, the error screen, and the `revision` counter every write path bumps so Stats and the Drive screen's lifetime-points readout stay in sync. |

### Deliberate simplifications versus the ReminDiary template this was adapted from

1. **No web target.** The accelerometer is the entire premise; a browser tab on a
   laptop has nothing meaningful to score. This removes `react-native-web`, the
   `IndexedDbStore` backend, and any `Platform.OS === 'web'` branching from the
   `openStore`/`ThemeProvider` pattern ReminDiary uses.
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
- **Both smoothness signals are exponentially smoothed, never read raw.** A single
  pothole must not zero a trip's score; only sustained roughness should. See the doc
  comment at the top of `domain/scoring.ts` for the exact reasoning and the calibration
  constants — they are first-pass physics-based guesses, not tuned against real drives,
  and are deliberately concentrated in that one file so tuning stays a one-file change.
- **`score`, `smoothness`, and `points` getters are read-only derived state.** Nothing
  outside `SmoothnessEngine` mutates the running averages; a screen just pushes samples
  and reads the getters after each one.
- **A trip shorter than `MIN_TRIP_SECONDS` is discarded, not saved** (`domain/trip.ts`).
  This is deliberately part of the domain layer, not screen-level UI logic, since "was
  this actually a drive" is a fact about the trip, not about how a button was drawn.
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
- **Never compare `SmoothnessEngine.points` (or any rounded getter) across two moments
  with strict equality when the raw accumulation is still converging.** The getter is
  rounded for display; the true rate can be exactly right while two roundings a few
  seconds apart land ±1 apart purely from where each side's fraction happens to fall.
  Assert a tolerant range instead, and say why in the comment (see
  `scoring.test.ts`'s "points accrue proportionally" test).
- **A hand-typed unit-vector constant is not exact.** `0.577` is not `1/√3`; feeding it
  into `Math.hypot` produces a real, non-negligible magnitude error, not a floating-point
  edge case. Use `1 / Math.sqrt(3)` when a test needs an exact-magnitude diagonal
  orientation.
- **A class instance cannot be spread to build a partial fake.** `{ ...store, get: fn }`
  copies only own enumerable fields, not prototype methods, so a `SqliteStore`'s other
  methods come back `undefined` at runtime while type-checking fine. Bind explicitly per
  method instead.

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
