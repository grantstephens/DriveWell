/**
 * The leaf's color is the score made visible, like a traffic light that
 * shades smoothly instead of snapping: lush green when the driving is
 * smooth, through yellow-green and amber, to red when it's rough. Green to
 * red is the one palette every driver already reads at a glance — and it
 * matches the braking/cornering/acceleration lights on the end-of-drive
 * card. It is also the palette ~8% of men can't tell apart, which is why the
 * middle is a clearly different amber rather than a muddy blend, and why the
 * Drive screen never relies on colour alone (see leafEffects.ts: the leaf
 * wilts, and the screen edge glows).
 *
 * Pure interpolation over fixed stops, so the Drive screen, the stats
 * chart, and any future widget all render identical colors for identical
 * scores. The stops are weighted toward the top: ordinary driving scores in
 * the high 80s-90s and should read green, so the colour only turns toward
 * amber below ~85 and red below ~35.
 */

const STOPS: { at: number; rgb: [number, number, number] }[] = [
  { at: 0, rgb: [0xc6, 0x28, 0x28] }, // red
  { at: 35, rgb: [0xef, 0x6c, 0x00] }, // orange
  { at: 65, rgb: [0xf9, 0xc0, 0x24] }, // amber
  { at: 85, rgb: [0x9b, 0xc5, 0x3d] }, // yellow-green
  { at: 100, rgb: [0x2e, 0x7d, 0x32] }, // lush green
];

/** leafColor maps a 0-100 smoothness to the leaf's fill color. */
export function leafColor(smoothness: number): string {
  const s = Math.min(100, Math.max(0, smoothness));
  let lo = STOPS[0]!;
  let hi = STOPS[STOPS.length - 1]!;
  for (let i = 1; i < STOPS.length; i++) {
    if (s <= STOPS[i]!.at) {
      lo = STOPS[i - 1]!;
      hi = STOPS[i]!;
      break;
    }
  }
  const span = hi.at - lo.at;
  const f = span === 0 ? 0 : (s - lo.at) / span;
  const mix = lo.rgb.map((c, i) => Math.round(c + f * (hi.rgb[i]! - c)));
  return `#${mix.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}
