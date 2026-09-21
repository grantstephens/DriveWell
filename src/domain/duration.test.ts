import { formatClock, formatHoursMinutes } from './duration';

test('formatClock renders sub-minute and multi-minute durations as mm:ss', () => {
  expect(formatClock(0)).toBe('0:00');
  expect(formatClock(5)).toBe('0:05');
  expect(formatClock(65)).toBe('1:05');
  expect(formatClock(599)).toBe('9:59');
});

test('formatClock switches to h:mm:ss at an hour', () => {
  expect(formatClock(3600)).toBe('1:00:00');
  expect(formatClock(3725)).toBe('1:02:05');
});

test('formatClock rounds fractional seconds and rejects negatives', () => {
  expect(formatClock(59.6)).toBe('1:00');
  expect(formatClock(-5)).toBe('0:00');
});

test('formatHoursMinutes omits the hour when there is none', () => {
  expect(formatHoursMinutes(0)).toBe('0m');
  expect(formatHoursMinutes(59)).toBe('0m');
  expect(formatHoursMinutes(600)).toBe('10m');
});

test('formatHoursMinutes includes the hour once driving time reaches one', () => {
  expect(formatHoursMinutes(3600)).toBe('1h 0m');
  expect(formatHoursMinutes(3600 * 2 + 60 * 15)).toBe('2h 15m');
});
