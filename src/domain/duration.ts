/**
 * Duration formatting. Two shapes for two audiences: formatClock is the
 * live, ticking readout on the Drive screen (always mm:ss, or h:mm:ss past
 * an hour); formatHoursMinutes is the lifetime-total readout on the Stats
 * screen, where second-level precision would be noise.
 */

/** formatClock renders whole seconds as mm:ss, or h:mm:ss at or past an hour. */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const mm = String(minutes).padStart(hours > 0 ? 2 : 1, '0');
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** formatHoursMinutes renders whole seconds as "3h 45m", "45m", or "0m". */
export function formatHoursMinutes(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}
