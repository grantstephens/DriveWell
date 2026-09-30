import type { Breakdown, Light } from './breakdown';

/** Where a curious recipient can find the app. */
export const SHARE_URL = 'https://github.com/grantstephens/DriveWell';

const CIRCLE: Record<Light, string> = {
  green: '🟢',
  amber: '🟡',
  red: '🔴',
  unknown: '⚪',
};

/**
 * formatShareText builds the end-of-drive card people paste into a chat —
 * Wordle's trick, a few coloured circles that say how it went at a glance and
 * make you want to compare. Plain text on purpose: it survives every messaging
 * app, needs no image rendering, and goes through the OS share sheet.
 *
 * `tripNumber` is the drive's place in the user's own history (their nth
 * trip), the closest thing to Wordle's puzzle number a private, offline app
 * has. Nothing else about the drive — no time, no place — is included.
 */
export function formatShareText(input: { tripNumber: number; score: number; breakdown: Breakdown }): string {
  const { tripNumber, score, breakdown } = input;
  return [
    `🍃 DriveWell #${tripNumber} · ${Math.round(score)}%`,
    `${CIRCLE[breakdown.braking.light]} Braking`,
    `${CIRCLE[breakdown.cornering.light]} Cornering`,
    `${CIRCLE[breakdown.acceleration.light]} Acceleration`,
    '',
    SHARE_URL,
  ].join('\n');
}
