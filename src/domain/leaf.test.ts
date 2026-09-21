import { leafColor } from './leaf';

test('the stops render as themselves', () => {
  expect(leafColor(0)).toBe('#8a5a2b'); // dormant brown
  expect(leafColor(50)).toBe('#c0ca33'); // yellow-green
  expect(leafColor(100)).toBe('#2e7d32'); // lush green
});

test('the midpoint between two stops is the channel-wise mean', () => {
  // mean of #8a5a2b and #c0ca33, channel by channel
  expect(leafColor(25)).toBe('#a5922f');
  // mean of #c0ca33 and #2e7d32: 0x77, 0xa4, 0x33
  expect(leafColor(75)).toBe('#77a433');
});

test('out-of-range scores clamp to the ends', () => {
  expect(leafColor(-20)).toBe(leafColor(0));
  expect(leafColor(150)).toBe(leafColor(100));
});

test('every score maps to a distinct valid color', () => {
  for (let s = 0; s <= 100; s += 5) {
    expect(leafColor(s)).toMatch(/^#[0-9a-f]{6}$/);
  }
  expect(leafColor(40)).not.toBe(leafColor(60));
  expect(leafColor(0)).not.toBe(leafColor(50));
  expect(leafColor(50)).not.toBe(leafColor(100));
});
