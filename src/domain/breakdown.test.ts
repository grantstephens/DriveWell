import { DriveBreakdown, lightForEvents, type DriveSample } from './breakdown';

const HZ = 50;
const DT_MS = 1000 / HZ;
const G = 9.81;

type Vec = [number, number, number];
type Mat = [Vec, Vec, Vec];

/** A fixed rotation (ZYX Euler, radians): how the phone happens to sit relative to the car. */
function rotation(yaw: number, pitch: number, roll: number): Mat {
  const [cy, sy, cp, sp, cr, sr] = [
    Math.cos(yaw),
    Math.sin(yaw),
    Math.cos(pitch),
    Math.sin(pitch),
    Math.cos(roll),
    Math.sin(roll),
  ];
  return [
    [cy * cp, cy * sp * sr - sy * cr, cy * sp * cr + sy * sr],
    [sy * cp, sy * sp * sr + cy * cr, sy * sp * cr - cy * sr],
    [-sp, cp * sr, cp * cr],
  ];
}

function apply(m: Mat, v: Vec): Vec {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}

const ORIENTATIONS: { name: string; rot: Mat }[] = [
  { name: 'flat, facing forward', rot: rotation(0, 0, 0) },
  { name: 'rolled on its side', rot: rotation(0, 0, Math.PI / 2) },
  { name: 'tilted every which way', rot: rotation(0.7, 0.45, -1.2) },
];

/**
 * A stretch of driving in the *car's* own frame: forward acceleration and
 * left acceleration in g (a left turn is positive), at a given speed (m/s,
 * which turns lateral g into a physically consistent yaw rate).
 */
interface Seg {
  s: number;
  along?: number;
  alat?: number;
  speed?: number;
  /** Phone orientation for this stretch, overriding the drive's (a phone still being fiddled with). */
  rot?: Mat;
  /** Wall-clock seconds the sensors deliver nothing before this stretch (app in the background, say). */
  gapBefore?: number;
  /** The phone is being picked up and fiddled with: violent forces and rotation about horizontal axes. */
  handled?: boolean;
}

const cruise = (s: number): Seg => ({ s });

/** A harsh, ~2 s longitudinal event: ramp in, hold, ramp out. Negative = braking. */
function longEvent(peakG: number): Seg[] {
  return [
    { s: 0.4, along: peakG / 2 },
    { s: 1.2, along: peakG },
    { s: 0.4, along: peakG / 2 },
  ];
}

/** A corner: positive alat = left. */
function corner(peakG: number, s = 2): Seg[] {
  return [
    { s: 0.5, alat: peakG / 2, speed: 14 },
    { s, alat: peakG, speed: 14 },
    { s: 0.5, alat: peakG / 2, speed: 14 },
  ];
}

function simulate(segs: Seg[], rot: Mat, withGyro = true): DriveSample[] {
  const out: DriveSample[] = [];
  let t = 1_700_000_000_000;
  let k = 0;
  for (const seg of segs) {
    const n = Math.round(seg.s * HZ);
    t += (seg.gapBefore ?? 0) * 1000;
    for (let i = 0; i < n; i++, k++) {
      const fiddle = seg.handled ? Math.sin(k * 0.05) : 0;
      const carForce: Vec = [
        (seg.along ?? 0) + (k % 2 === 0 ? 0.02 : -0.02) + 0.7 * fiddle,
        (seg.alat ?? 0) + (k % 3 === 0 ? 0.02 : -0.02) + 0.5 * Math.cos(k * 0.045) * (seg.handled ? 1 : 0),
        1 + (k % 2 === 0 ? -0.03 : 0.03),
      ];
      const segRot = seg.rot ?? rot;
      const [x, y, z] = apply(segRot, carForce);
      const sample: DriveSample = { x, y, z, t };
      if (withGyro) {
        const yawRate = ((seg.alat ?? 0) * G) / (seg.speed ?? 15);
        const [gx, gy, gz] = apply(segRot, [
          seg.handled ? 2.5 * Math.sin(k * 0.09) : 0,
          seg.handled ? 1.5 * Math.cos(k * 0.07) : 0,
          yawRate + (k % 2 === 0 ? 0.004 : -0.004),
        ]);
        sample.gx = gx;
        sample.gy = gy;
        sample.gz = gz;
      }
      out.push(sample);
      t += DT_MS;
    }
  }
  return out;
}

function analyse(samples: DriveSample[]) {
  const b = new DriveBreakdown();
  for (const s of samples) b.push(s);
  return b.result();
}

/** Ordinary driving: gentle speed changes and a few gentle bends (so a gyro has something to learn from). */
function ordinary(): Seg[] {
  return [
    cruise(8),
    { s: 6, along: 0.08 },
    cruise(10),
    ...corner(0.12, 3),
    cruise(10),
    { s: 4, along: -0.09 },
    cruise(8),
    ...corner(-0.13, 3),
    cruise(10),
  ];
}

describe.each(ORIENTATIONS)('with the phone $name', ({ rot }) => {
  test('gentle, ordinary driving is all green', () => {
    const r = analyse(simulate(ordinary(), rot));
    expect(r.braking).toEqual({ light: 'green', events: 0 });
    expect(r.cornering).toEqual({ light: 'green', events: 0 });
    expect(r.acceleration).toEqual({ light: 'green', events: 0 });
  });

  test('harsh braking lights up braking and nothing else', () => {
    const segs = [...ordinary(), ...longEvent(-0.4), cruise(10), ...longEvent(-0.42), cruise(10), ...longEvent(-0.4), cruise(8)];
    const r = analyse(simulate(segs, rot));
    expect(r.braking.events).toBe(3);
    expect(r.braking.light).toBe('red');
    expect(r.acceleration).toEqual({ light: 'green', events: 0 });
    expect(r.cornering).toEqual({ light: 'green', events: 0 });
  });

  // The case a "braking hits harder than acceleration" shortcut gets wrong,
  // and the reason the forward direction comes from the gyroscope instead.
  test('a lead foot (harsh acceleration, gentle braking) lights up acceleration, not braking', () => {
    const segs = [...ordinary(), ...longEvent(0.35), cruise(10), ...longEvent(0.36), cruise(8)];
    const r = analyse(simulate(segs, rot));
    expect(r.acceleration.events).toBe(2);
    expect(r.acceleration.light).toBe('red');
    expect(r.braking).toEqual({ light: 'green', events: 0 });
    expect(r.cornering).toEqual({ light: 'green', events: 0 });
  });

  test('harsh corners, left and right, light up cornering and nothing else', () => {
    const segs = [...ordinary(), ...corner(0.45), cruise(10), ...corner(-0.45), cruise(8)];
    const r = analyse(simulate(segs, rot));
    expect(r.cornering.events).toBe(2);
    expect(r.cornering.light).toBe('red');
    expect(r.braking).toEqual({ light: 'green', events: 0 });
    expect(r.acceleration).toEqual({ light: 'green', events: 0 });
  });

  // Found on a real drive: the phone was tilted about while being mounted and
  // an online gravity estimate was still converging for the first minute,
  // leaking ~0.16 g of tilt error into "forward" — false accelerations, and
  // braking hidden. The estimate now comes from the whole drive, so a
  // fiddly start costs nothing.
  test('a phone still being tilted into its mount at the start does not fake harsh events', () => {
    const start: Seg[] = [{ s: 4, rot: rotation(0.3, -0.5, 0.4) }];
    const segs = [...start, ...ordinary()];
    const r = analyse(simulate(segs, rot));
    expect(r.braking).toEqual({ light: 'green', events: 0 });
    expect(r.cornering).toEqual({ light: 'green', events: 0 });
    expect(r.acceleration).toEqual({ light: 'green', events: 0 });
  });

  test('a long stretch with no sensor data does not disturb the rest of the drive', () => {
    const segs = [...ordinary(), { s: 14, gapBefore: 400 }, ...longEvent(-0.4), cruise(10), ...longEvent(-0.4), cruise(8)];
    const r = analyse(simulate(segs, rot));
    expect(r.braking.events).toBe(2);
    expect(r.acceleration.events).toBe(0);
    expect(r.cornering.events).toBe(0);
  });

  // Found on a real drive: the app came back to the foreground after a long
  // hole, the phone was picked up (2.4 rad/s of rotation about horizontal
  // axes — driving never does that), and the resulting forces read as a cluster
  // of harsh brake/corner events. The gyroscope can tell the difference.
  test('picking the phone up mid-drive is not driving', () => {
    const segs = [...ordinary(), cruise(6), { s: 4, handled: true }, cruise(10), ...ordinary()];
    const r = analyse(simulate(segs, rot));
    expect(r.braking).toEqual({ light: 'green', events: 0 });
    expect(r.cornering).toEqual({ light: 'green', events: 0 });
    expect(r.acceleration).toEqual({ light: 'green', events: 0 });
  });

  test('the first seconds after a hole in the sensor data are treated as settling, later ones count', () => {
    const right = (gap: number, beforeEvent: number): Seg[] => [
      ...ordinary(),
      { s: 4, gapBefore: gap },
      cruise(beforeEvent),
      ...longEvent(-0.4),
      cruise(10),
    ];
    // Event ~3 s after the app returns: ignored. ~20 s after: counted.
    expect(analyse(simulate(right(120, 1), rot)).braking.events).toBe(0);
    expect(analyse(simulate(right(120, 20), rot)).braking.events).toBe(1);
  });

  test('a phone bumped while being mounted, or tapped to end the drive, is not a harsh event', () => {
    const jolt: Seg[] = [{ s: 0.1, along: 3, alat: -2 }, { s: 0.1, along: -3, alat: 2 }];
    const segs = [...jolt, ...ordinary(), ...jolt];
    const r = analyse(simulate(segs, rot));
    expect(r.braking.events).toBe(0);
    expect(r.cornering.events).toBe(0);
    expect(r.acceleration.events).toBe(0);
  });
});

describe('without a gyroscope', () => {
  const rot = ORIENTATIONS[2]!.rot;

  test('a drive dominated by braking and acceleration still gets sorted correctly', () => {
    const segs = [
      ...ordinary(),
      ...longEvent(-0.4),
      cruise(6),
      ...longEvent(-0.4),
      cruise(6),
      ...longEvent(-0.38),
      cruise(6),
      ...longEvent(0.2),
      cruise(8),
    ];
    const r = analyse(simulate(segs, rot, false));
    expect(r.braking.events).toBe(3);
    expect(r.cornering.events).toBe(0);
  });

  test('says "unknown" rather than guessing when forward and sideways cannot be told apart', () => {
    // As much harsh cornering as harsh braking: with only one sensor the two
    // axes are indistinguishable, and a confident wrong label is worse than none.
    const segs = [
      cruise(8),
      ...longEvent(-0.4),
      cruise(5),
      ...corner(0.4, 1.2),
      cruise(5),
      ...longEvent(-0.4),
      cruise(5),
      ...corner(-0.4, 1.2),
      cruise(5),
      ...longEvent(-0.4),
      cruise(5),
      ...corner(0.4, 1.2),
      cruise(8),
    ];
    const r = analyse(simulate(segs, rot, false));
    expect(r.braking.light).toBe('unknown');
    expect(r.cornering.light).toBe('unknown');
    expect(r.acceleration.light).toBe('unknown');
  });

  test('a genuinely smooth drive is still green, not unknown', () => {
    const r = analyse(simulate(ordinary(), rot, false));
    expect(r.braking.light).toBe('green');
    expect(r.cornering.light).toBe('green');
    expect(r.acceleration.light).toBe('green');
  });
});

test('a drive with nothing in it is all green', () => {
  const r = new DriveBreakdown().result();
  expect(r.braking).toEqual({ light: 'green', events: 0 });
  expect(r.cornering).toEqual({ light: 'green', events: 0 });
  expect(r.acceleration).toEqual({ light: 'green', events: 0 });
});

describe('lightForEvents', () => {
  test.each([
    // events, seconds, expected
    [0, 600, 'green'],
    [1, 600, 'amber'],
    [2, 600, 'amber'],
    [3, 600, 'red'],
    [1, 3600, 'amber'],
    [10, 3600, 'amber'],
    [13, 3600, 'red'],
    // A very short trip is judged as if it were five minutes long, so one
    // slip in a two-minute hop is amber at worst, never an automatic red.
    [1, 60, 'amber'],
    [2, 60, 'red'],
  ] as const)('%i events in %i s is %s', (events, seconds, expected) => {
    expect(lightForEvents(events, seconds)).toBe(expected);
  });
});
