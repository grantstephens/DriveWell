import { edgeGlowLevels, LeafEventDetector, leafSeverity } from './leafEffects';

describe('leafSeverity', () => {
  test.each([
    [100, 0],
    [90, 0], // ordinary smooth driving never registers
    [88, 0],
    [35, 1],
    [0, 1],
  ])('smoothness %i is severity %f', (smoothness, expected) => {
    expect(leafSeverity(smoothness)).toBe(expected);
  });

  test('rises steadily between the two ends', () => {
    expect(leafSeverity(80)).toBeGreaterThan(0);
    expect(leafSeverity(60)).toBeGreaterThan(leafSeverity(80));
    expect(leafSeverity(40)).toBeGreaterThan(leafSeverity(60));
    expect(leafSeverity(40)).toBeLessThan(1);
  });
});

describe('edgeGlowLevels', () => {
  test('nothing at all when driving is fine', () => {
    expect(edgeGlowLevels(0)).toEqual({ amber: 0, red: 0 });
  });

  test('amber builds first, peaks mid-way, then hands over to red', () => {
    const mild = edgeGlowLevels(0.25);
    const middling = edgeGlowLevels(0.5);
    const bad = edgeGlowLevels(0.8);
    const worst = edgeGlowLevels(1);
    expect(mild.amber).toBeGreaterThan(0);
    expect(mild.red).toBe(0);
    expect(middling.amber).toBeCloseTo(1);
    expect(middling.red).toBe(0);
    expect(bad.red).toBeGreaterThan(0);
    expect(bad.amber).toBeLessThan(middling.amber);
    expect(worst).toEqual({ amber: 0, red: 1 });
  });
});

describe('LeafEventDetector', () => {
  test('a smooth drive produces no events', () => {
    const d = new LeafEventDetector();
    for (const s of [100, 98, 95, 99, 100, 92]) expect(d.update(s)).toBeNull();
  });

  test('a sharp fall is one impact, however long the rough patch lasts', () => {
    const d = new LeafEventDetector();
    expect(d.update(95)).toBeNull();
    expect(d.update(60)).toBe('impact');
    // Hovering in the mid-range or dipping further must not fire again.
    for (const s of [55, 70, 40, 62, 30, 75]) expect(d.update(s)).toBeNull();
  });

  test('recovering to green after an impact is one recovery', () => {
    const d = new LeafEventDetector();
    d.update(95);
    expect(d.update(40)).toBe('impact');
    expect(d.update(80)).toBeNull(); // better, not yet back
    expect(d.update(92)).toBe('recovery');
    expect(d.update(97)).toBeNull();
  });

  test('a second harsh event after recovering is a second impact', () => {
    const d = new LeafEventDetector();
    d.update(95);
    d.update(40);
    d.update(95);
    expect(d.update(50)).toBe('impact');
  });

  test('a long mildly-rough road that never dips below the threshold stays quiet', () => {
    const d = new LeafEventDetector();
    for (let i = 0; i < 50; i++) expect(d.update(72 + (i % 3) * 3)).toBeNull();
  });

  // A rough country road can sit at 80-87 the whole way and never reach the
  // 88+ of a smooth one; a genuinely harsh event on it must still register.
  test('a harsh event on a road that was merely rough all along still counts', () => {
    const d = new LeafEventDetector();
    for (const s of [84, 82, 86, 81, 83]) expect(d.update(s)).toBeNull();
    expect(d.update(42)).toBe('impact');
  });

  test('a drive that starts rough is not an "impact" until it has been smooth first', () => {
    const d = new LeafEventDetector();
    expect(d.update(30)).toBeNull();
    expect(d.update(20)).toBeNull();
    expect(d.update(95)).toBeNull(); // and its recovery is not a reward for nothing
  });
});
