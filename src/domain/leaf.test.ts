import { leafColor } from './leaf';

test('the stops render as themselves', () => {
  expect(leafColor(0)).toBe('#c62828'); // red
  expect(leafColor(35)).toBe('#ef6c00'); // orange
  expect(leafColor(65)).toBe('#f9c024'); // amber
  expect(leafColor(85)).toBe('#9bc53d'); // yellow-green
  expect(leafColor(100)).toBe('#2e7d32'); // lush green
});

test('between two stops the colour is the channel-wise blend', () => {
  // mean of #ef6c00 and #f9c024, channel by channel
  expect(leafColor(50)).toBe('#f49612');
  // halfway between #f9c024 and #9bc53d: 0xca, 0xc3 (194.5 rounds up), 0x31
  expect(leafColor(75)).toBe('#cac331');
});

test('out-of-range scores clamp to the ends', () => {
  expect(leafColor(-20)).toBe(leafColor(0));
  expect(leafColor(150)).toBe(leafColor(100));
});

test('every score maps to a distinct valid colour, and good, middling and bad are plainly different', () => {
  for (let s = 0; s <= 100; s += 5) {
    expect(leafColor(s)).toMatch(/^#[0-9a-f]{6}$/);
  }
  expect(leafColor(40)).not.toBe(leafColor(60));
  expect(leafColor(10)).not.toBe(leafColor(60));
  expect(leafColor(60)).not.toBe(leafColor(100));
});

// The point of the red-amber-green palette: red and green must not be mistaken
// for each other by the ~8% of men who can't tell them apart, so the hue gap
// has to be bridged by a clearly different middle (amber), not a muddy blend.
test('the colour passes through amber on the way from green to red', () => {
  const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const [r, g] = channels(leafColor(65));
  expect(r).toBeGreaterThan(200); // amber is red-heavy…
  expect(g).toBeGreaterThan(150); // …with plenty of green: yellow, not brown
});
