import { isDriveWorthSaving, MIN_TRIP_SECONDS } from './trip';

test('a drive at or above the minimum, with live time to match, is worth saving', () => {
  expect(isDriveWorthSaving(MIN_TRIP_SECONDS, MIN_TRIP_SECONDS)).toBe(true);
});

test('a drive shorter than the minimum is not worth saving', () => {
  expect(isDriveWorthSaving(MIN_TRIP_SECONDS - 1, MIN_TRIP_SECONDS - 1)).toBe(false);
});

// Found in final review: a phone left on a table passes the wall-clock
// duration check (seconds keeps ticking regardless of liveness) but proves
// nothing was ever actually driven — it must not be saved as a trip, let
// alone a perfect 100%.
test('a drive long enough by the clock but with no live time is not worth saving', () => {
  expect(isDriveWorthSaving(60, 0)).toBe(false);
});
