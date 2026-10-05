import { act, render, screen } from '@testing-library/react-native';
import React from 'react';

import { animationConfig } from './animation';
import { Leaf } from './Leaf';

beforeAll(() => {
  animationConfig.useNativeDriver = false;
});
beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

const settle = (ms = 1000) => act(async () => void jest.advanceTimersByTime(ms));
const opacity = (id: string): number => screen.getByTestId(id).props.style.opacity;
const rotation = (): string =>
  screen.getByTestId('leaf-wilt').props.style.transform.find((t: object) => 'rotate' in t).rotate;

test('draws the leaf in the colour it is given', async () => {
  await render(<Leaf color="#2e7d32" smoothness={100} />);
  expect(screen.getByTestId('leaf-path').props.style[0].color).toBe('#2e7d32');
});

describe('wilting', () => {
  test('stands upright when driving is fine', async () => {
    await render(<Leaf color="#2e7d32" smoothness={100} droop={0} />);
    await settle();
    expect(rotation()).toBe('0deg');
  });

  test('droops as things get rough and perks up again on recovery, gradually', async () => {
    const view = await render(<Leaf color="#c62828" smoothness={20} droop={0} />);
    await view.rerender(<Leaf color="#c62828" smoothness={20} droop={1} />);
    await settle(100);
    const midway = parseFloat(rotation());
    await settle(1500);
    const wilted = parseFloat(rotation());
    expect(wilted).toBeLessThan(-5); // visibly tilted
    expect(midway).toBeGreaterThan(wilted); // it got there gradually

    await view.rerender(<Leaf color="#2e7d32" smoothness={100} droop={0} />);
    await settle(1500);
    expect(parseFloat(rotation())).toBeCloseTo(0);
  });

  test('with reduce-motion on the droop is applied at once', async () => {
    const view = await render(<Leaf color="#2e7d32" smoothness={100} droop={0} reduceMotion />);
    await view.rerender(<Leaf color="#c62828" smoothness={20} droop={1} reduceMotion />);
    expect(parseFloat(rotation())).toBeLessThan(-5);
  });
});

describe('the impact ripple', () => {
  test('is invisible until something happens, and not triggered by merely mounting', async () => {
    await render(<Leaf color="#c62828" smoothness={20} impactSignal={3} />);
    await settle(100);
    expect(opacity('leaf-ripple')).toBe(0);
  });

  test('is one short ring: appears on an impact, then is gone again', async () => {
    const view = await render(<Leaf color="#c62828" smoothness={20} impactSignal={0} />);
    await view.rerender(<Leaf color="#c62828" smoothness={20} impactSignal={1} />);
    await settle(150);
    expect(opacity('leaf-ripple')).toBeGreaterThan(0.1);
    await settle(1200);
    expect(opacity('leaf-ripple')).toBe(0);
  });

  test('is skipped entirely with reduce-motion on', async () => {
    const view = await render(<Leaf color="#c62828" smoothness={20} impactSignal={0} reduceMotion />);
    await view.rerender(<Leaf color="#c62828" smoothness={20} impactSignal={1} reduceMotion />);
    await settle(150);
    expect(opacity('leaf-ripple')).toBe(0);
  });
});

describe('the recovery bloom', () => {
  test('is a soft glow that swells on recovery and fades away', async () => {
    const view = await render(<Leaf color="#2e7d32" smoothness={95} recoverySignal={0} />);
    await view.rerender(<Leaf color="#2e7d32" smoothness={95} recoverySignal={1} />);
    await settle(300);
    expect(opacity('leaf-bloom')).toBeGreaterThan(0.1);
    await settle(1500);
    expect(opacity('leaf-bloom')).toBe(0);
  });

  test('is skipped with reduce-motion on', async () => {
    const view = await render(<Leaf color="#2e7d32" smoothness={95} recoverySignal={0} reduceMotion />);
    await view.rerender(<Leaf color="#2e7d32" smoothness={95} recoverySignal={1} reduceMotion />);
    await settle(300);
    expect(opacity('leaf-bloom')).toBe(0);
  });
});
