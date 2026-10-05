import { act, render, screen } from '@testing-library/react-native';
import React from 'react';

import { animationConfig } from './animation';
import { EdgeGlow } from './EdgeGlow';

beforeAll(() => {
  animationConfig.useNativeDriver = false;
});
beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

const opacity = (id: string): number => screen.getByTestId(id).props.style.opacity;
const settle = (ms = 1000) => act(async () => void jest.advanceTimersByTime(ms));

test('is invisible, and never intercepts touches, when driving is fine', async () => {
  await render(<EdgeGlow severity={0} />);
  await settle();
  expect(opacity('edge-glow-amber')).toBe(0);
  expect(opacity('edge-glow-red')).toBe(0);
  expect(screen.getByTestId('edge-glow').props.pointerEvents).toBe('none');
});

test('glows amber when things get rough, and red only when they get bad', async () => {
  const view = await render(<EdgeGlow severity={0.5} />);
  await settle();
  expect(opacity('edge-glow-amber')).toBeGreaterThan(0.3);
  expect(opacity('edge-glow-red')).toBe(0);

  await view.rerender(<EdgeGlow severity={1} />);
  await settle();
  expect(opacity('edge-glow-red')).toBeGreaterThan(0.3);
  expect(opacity('edge-glow-amber')).toBeLessThan(0.05);
});

test('fades in and out rather than snapping', async () => {
  const view = await render(<EdgeGlow severity={0} />);
  await view.rerender(<EdgeGlow severity={0.5} />);
  await settle(100);
  const early = opacity('edge-glow-amber');
  await settle(1000);
  const settled = opacity('edge-glow-amber');
  expect(early).toBeGreaterThan(0);
  expect(early).toBeLessThan(settled);
});

// Safety and comfort: a pulse is allowed, a flash is not. It breathes slowly,
// between most and all of its strength, and never goes dark.
test('a bad drive pulses slowly and gently, never flashing', async () => {
  await render(<EdgeGlow severity={1} />);
  await settle(1000);
  const samples: number[] = [];
  for (let i = 0; i < 40; i++) {
    await settle(100);
    samples.push(opacity('edge-glow-red'));
  }
  const peak = Math.max(...samples);
  const trough = Math.min(...samples);
  expect(peak - trough).toBeGreaterThan(0.02); // it does move…
  expect(trough).toBeGreaterThan(peak * 0.7); // …but never close to off
});

test('with reduce-motion on it snaps to its level and stays perfectly still', async () => {
  const view = await render(<EdgeGlow severity={1} reduceMotion />);
  expect(opacity('edge-glow-red')).toBeGreaterThan(0.3); // immediately, no fade
  const first = opacity('edge-glow-red');
  await settle(3000);
  expect(opacity('edge-glow-red')).toBe(first);
  await view.rerender(<EdgeGlow severity={0} reduceMotion />);
  expect(opacity('edge-glow-red')).toBe(0);
});
