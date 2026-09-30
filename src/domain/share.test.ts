import type { Breakdown } from './breakdown';
import { formatShareText, SHARE_URL } from './share';

const breakdown = (braking: string, cornering: string, acceleration: string): Breakdown =>
  ({
    braking: { light: braking, events: 0 },
    cornering: { light: cornering, events: 0 },
    acceleration: { light: acceleration, events: 0 },
  }) as Breakdown;

test('formats a Wordle-style card: trip number, score, then one traffic light per skill', () => {
  expect(formatShareText({ tripNumber: 12, score: 91.4, breakdown: breakdown('green', 'amber', 'red') })).toBe(
    ['🍃 DriveWell #12 · 91%', '🟢 Braking', '🟡 Cornering', '🔴 Acceleration', '', SHARE_URL].join('\n'),
  );
});

test('a light that could not be determined shows as a grey circle, never a guess', () => {
  const text = formatShareText({ tripNumber: 1, score: 100, breakdown: breakdown('unknown', 'unknown', 'green') });
  expect(text).toContain('⚪ Braking');
  expect(text).toContain('⚪ Cornering');
  expect(text).toContain('🟢 Acceleration');
});

test('the score is rounded to a whole percent', () => {
  expect(formatShareText({ tripNumber: 3, score: 87.5, breakdown: breakdown('green', 'green', 'green') })).toContain('· 88%');
});
