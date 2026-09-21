import { formatTimestamp } from './timestamp';

test('fractional seconds are dropped', () => {
  expect(formatTimestamp(new Date('2026-09-21T12:34:56.789Z'))).toBe('2026-09-21T12:34:56Z');
});

test('whole seconds survive unchanged', () => {
  expect(formatTimestamp(new Date('2026-09-21T12:34:56.000Z'))).toBe('2026-09-21T12:34:56Z');
});

test('lexicographic order is chronological order', () => {
  const a = formatTimestamp(new Date('2026-09-21T12:34:56.999Z'));
  const b = formatTimestamp(new Date('2026-09-21T12:34:57.000Z'));
  expect(a < b).toBe(true);
});
