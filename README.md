# DriveWell

Drive with this app open and it scores how smooth you are, using nothing but your
phone's accelerometer. A leaf on screen turns from dormant brown through yellow to
lush green as your driving smooths out; once it's fully green, you start racking up
points. Smooth driving is efficient driving — this is a nudge toward more of it, with a
little gamification to make the nudge stick.

Everything happens on the device. No account, no sync, no GPS, no network requests at
all — DriveWell has nothing to send and nowhere to send it.

[![Licence: GPL v3](https://img.shields.io/badge/Licence-GPLv3-blue.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/grantstephens/DriveWell?include_prereleases)](https://github.com/grantstephens/DriveWell/releases)
[![F-Droid](https://img.shields.io/f-droid/v/xyz.hub13.drivewell)](https://f-droid.org/packages/xyz.hub13.drivewell/)

Built with [React Native](https://reactnative.dev) (Expo), targeting Android.

## Installing

### On F-Droid

[<img src="https://fdroid.gitlab.io/artwork/badge/get-it-on.png" alt="Get it on F-Droid" height="80">](https://f-droid.org/packages/xyz.hub13.drivewell/)

(Pending the app's first tagged release and submission to fdroiddata — see
`fdroid/xyz.hub13.drivewell.yml`.)

### With Obtainium (recommended)

[Obtainium](https://github.com/ImranR98/Obtainium) installs apps straight from GitHub and
keeps them updated, with no app store in the middle.

1. Install Obtainium.
2. Tap **Add App**.
3. Paste `https://github.com/grantstephens/DriveWell`.
4. Tap **Add**, then **Install**.

### Directly

Download the APK from the [Releases page](https://github.com/grantstephens/DriveWell/releases)
and open it. Android will warn you about installing from an unknown source, because the
app is signed with the project's own key rather than distributed through Play.

> **On permissions:** the only Android permission any release declares is `INTERNET`,
> which nothing in the app ever uses (DriveWell makes zero network requests) — it exists
> only because the React Native template bakes it in. Everything sensor-related
> (`ACTIVITY_RECOGNITION` and friends, pulled in transitively by `expo-sensors`) is
> explicitly blocked. Check any release for yourself with `aapt dump permissions <apk>`.

## Using it

Three screens:

- **Drive** — the leaf. Tap **Start Drive** before you pull off; the leaf tracks your
  smoothness live. Tap **End Drive** when you arrive to save the trip and see your
  score and points.
- **Stats** — lifetime points, your best drive, your average, total time behind the
  wheel, and a "your last 5 drives vs. the 5 before" trend so you can see whether you're
  actually getting smoother.
- **Settings** — a plain-language explanation of how scoring works, and the one
  destructive action: delete your driving history.

### How the score works

DriveWell reads the accelerometer's total magnitude — orientation-independent, so it
doesn't matter where in the car the phone is mounted. Two things move that magnitude
away from a resting 1 g: **jerk** (how fast acceleration is changing — hard braking,
throttle stabs, swerves, potholes) and **sustained** acceleration (steady-state, like a
long hard corner). Both are smoothed with a multi-second exponential average, so a
single pothole doesn't tank your score — but a whole rough drive will. Once the leaf
crosses into green, points accrue for as long as you stay there.

The constants behind that mapping are first-pass calibration from accelerometer
physics, not tuned against real fleets of drives — see the comments in
`src/domain/scoring.ts` if you want to adjust them.

### Your data

Trips are stored in the app's private storage on the device. **Uninstalling the app
deletes your driving history.** There is no export, by design — nothing here leaves the
phone.

## Development

Toolchain is pinned in [`mise.toml`](mise.toml) — run `mise install` after cloning.
Install tools through `mise`, not a system package manager or a global `npm -g`.

```bash
make            # list every target
make check      # tsc --noEmit && jest — the gate before any commit
make start      # Expo dev server; scan the QR code with Expo Go
make android    # Expo dev server, opening on a connected device
```

Android is the only shipping target — there's no accelerometer to read in a browser tab.

### Layout

```
src/domain/       pure TypeScript: the scoring engine, leaf color, trips, stats, the
                  Store contract — no React, no Expo, tested in plain Node
src/storage/      SqliteStore (expo-sqlite on device, node:sqlite in tests), one
                  behavioural contract run against both
src/screens/      Drive, Stats, Settings
src/platform/     the one thing that differs per target: the accelerometer (motion.*)
src/components/   Leaf, the presentational SVG the Drive screen colors live
src/theme.ts, src/ThemeContext.tsx   light/dark palettes; follows the system setting
```

Dependencies point inward. `src/domain` imports nothing external, which is why it runs
in a plain Node Jest environment.

### Releasing

Pushing a `v*` tag (e.g. `v1.0.0`) triggers
[`.github/workflows/release.yml`](.github/workflows/release.yml), which builds a signed
APK and AAB and attaches them to a GitHub Release. `versionCode` is packed from the tag
itself (see [`tools/compute-version.sh`](tools/compute-version.sh) for the exact scheme),
so rebuilding a tag always reproduces the same value.

Before tagging, write the release notes to a file and run
`make prepare-release TAG=v1.0.1 CHANGELOG=path/to/notes.txt`. It computes the version and
commits it into `fdroid-version.txt`, so F-Droid's `checkupdates` has a real,
regex-extractable versionCode to read at that tag, and it copies your notes into
`fastlane/metadata/android/en-US/changelogs/<versionCode>.txt` for both split APKs'
versionCodes. Both files must exist *in the tagged commit*. Then tag and push as the
command's own output says:

```bash
make prepare-release TAG=v1.0.1 CHANGELOG=path/to/notes.txt
git tag v1.0.1
git push origin main v1.0.1
```

`fdroid/xyz.hub13.drivewell.yml` is a template for fdroiddata's submission, with the
`Builds:` entries commented out and marked `TODO` until v1.0.0 is tagged and published —
see the comments in that file for exactly what to fill in.

#### Signing setup

Android identifies an app by its signing certificate — every release must use the *same*
key, or existing users cannot upgrade. Generate it once, back it up somewhere you trust,
and never commit it:

```bash
keytool -genkeypair -v -keystore drivewell.keystore -storetype PKCS12 \
        -alias drivewell -keyalg RSA -keysize 4096 -validity 10000
```

Then set four repository secrets:

| Secret | Value |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | base64 of the `.keystore` file |
| `ANDROID_KEYSTORE_PASSWORD` | keystore password |
| `ANDROID_KEY_ALIAS` | key alias (`drivewell` above) |
| `ANDROID_KEY_PASSWORD` | key password |

```bash
base64 -w0 drivewell.keystore | gh secret set ANDROID_KEYSTORE_BASE64
gh secret set ANDROID_KEYSTORE_PASSWORD
gh secret set ANDROID_KEY_ALIAS
gh secret set ANDROID_KEY_PASSWORD
```

## Licence

[GPL-3.0-or-later](LICENSE). If you distribute a modified version, you must publish your
changes under the same licence.
