/**
 * The leaf's color is the score made visible: dormant brown when the driving
 * is rough, through yellow-green, to lush green at a smooth 100 — the same
 * idea as VW's BlueMotion ball, in green.
 *
 * Pure interpolation over three fixed stops, so the Drive screen, the stats
 * chart, and any future widget all render identical colors for identical
 * scores.
 */

const STOPS: { at: number; rgb: [number, number, number] }[] = [
  { at: 0, rgb: [0x8a, 0x5a, 0x2b] }, // dormant brown
  { at: 50, rgb: [0xc0, 0xca, 0x33] }, // yellow-green
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
