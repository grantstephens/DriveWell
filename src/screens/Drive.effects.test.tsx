import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import { AccessibilityInfo, AppState, type AppStateStatus } from 'react-native';
import { PaperProvider } from 'react-native-paper';

import { DriveProvider } from '../DriveContext';
import type { Store } from '../domain/store';
import { openNodeSqlite } from '../storage/nodeSqlite';
import { SqliteStore } from '../storage/SqliteStore';
import { lightTheme } from '../theme';
import { DriveScreen } from './Drive';

// Stand-ins that simply report what the screen told them, so these tests are
// about the screen's decisions, not about animation frames (see the
// components' own tests for those).
jest.mock('../components/Leaf', () => {
  const { Text } = require('react-native');
  return {
    Leaf: (p: { droop?: number; impactSignal?: number; recoverySignal?: number; reduceMotion?: boolean }) => (
      <Text testID="leaf-stub">
        {JSON.stringify({ droop: p.droop, impact: p.impactSignal, recovery: p.recoverySignal, reduce: p.reduceMotion })}
      </Text>
    ),
  };
});
jest.mock('../components/EdgeGlow', () => {
  const { Text } = require('react-native');
  return { EdgeGlow: (p: { severity: number }) => <Text testID="edge-stub">{String(p.severity)}</Text> };
});

jest.mock('../platform/motion');
const { startMotion } = require('../platform/motion') as { startMotion: jest.Mock };
jest.mock('../platform/confirm');
const { notify } = require('../platform/confirm') as { notify: jest.Mock };
jest.mock('expo-keep-awake', () => ({
  activateKeepAwakeAsync: jest.fn().mockResolvedValue(undefined),
  deactivateKeepAwake: jest.fn().mockResolvedValue(undefined),
}));

let store: Store;
let now: number;
let onSample: ((s: { x: number; y: number; z: number; t: number }) => void) | null;
const stopMotion = jest.fn();

beforeEach(async () => {
  store = await SqliteStore.open(openNodeSqlite(':memory:'));
  now = 1_000_000;
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  startMotion.mockReset();
  startMotion.mockImplementation(async (cb: typeof onSample) => {
    onSample = cb;
    return { stop: stopMotion };
  });
  notify.mockReset();
  notify.mockResolvedValue(undefined);
  stopMotion.mockReset();
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
});
afterEach(async () => {
  jest.restoreAllMocks();
  await store.close();
});

async function renderAndStart() {
  render(
    <PaperProvider theme={lightTheme}>
      <DriveProvider store={store}>
        <DriveScreen />
      </DriveProvider>
    </PaperProvider>,
  );
  await waitFor(() => expect(screen.getByTestId('drive-screen')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('drive-start'));
  await waitFor(() => expect(screen.getByTestId('drive-stop')).toBeTruthy());
}

let sensorT = 0;
/** Feed `seconds` of sensor data, moving the wall clock with it so the screen's UI throttle behaves. */
async function feed(seconds: number, sample: (i: number) => { x: number; y: number; z: number }) {
  await act(async () => {
    for (let i = 0; i < seconds * 10; i++) {
      now += 100;
      sensorT += 100;
      onSample?.({ ...sample(i), t: sensorT });
    }
  });
}
const smooth = (i: number) => ({ x: 0, y: 0, z: 1 + (i % 2 === 0 ? 0.01 : -0.01) });
/** A panic-stop-grade brake: ramps to 2 g of sustained deceleration. */
const harsh = (i: number) => ({ x: Math.min(2, 1 + i / 8), y: 0, z: 0 });

const leaf = () => JSON.parse(screen.getByTestId('leaf-stub').props.children);
const edge = () => Number(screen.getByTestId('edge-stub').props.children);

beforeEach(() => {
  sensorT = 0;
});

test('a smooth drive shows nothing: no glow, no droop, no ripple', async () => {
  await renderAndStart();
  await feed(15, smooth);
  expect(edge()).toBe(0);
  expect(leaf().droop).toBe(0);
  expect(leaf().impact).toBe(0);
});

test('a harsh event wilts the leaf, glows the edges and ripples once; recovering blooms once', async () => {
  await renderAndStart();
  await feed(10, smooth);
  const before = leaf();

  await feed(5, harsh);
  await waitFor(() => expect(edge()).toBeGreaterThan(0.9));
  expect(leaf().droop).toBeGreaterThan(0.9);
  expect(leaf().impact).toBe(before.impact + 1);
  expect(leaf().recovery).toBe(before.recovery);

  await feed(20, smooth);
  await waitFor(() => expect(edge()).toBe(0));
  expect(leaf().droop).toBe(0);
  expect(leaf().impact).toBe(before.impact + 1); // one ripple for the whole rough patch
  expect(leaf().recovery).toBe(before.recovery + 1);
});

// Phone-mounting jolts read as a harsh event at the start of every drive; the
// effects would fire each time if they weren't held back for a few seconds.
test('the first seconds of a drive are held back, so mounting the phone does not set it off', async () => {
  await renderAndStart();
  await feed(3, harsh);
  expect(edge()).toBe(0);
  expect(leaf().impact).toBe(0);
});

test('and so are the first seconds after coming back from another app', async () => {
  let handler: ((s: AppStateStatus) => void)[] = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_t: string, h: (s: AppStateStatus) => void) => {
    handler.push(h);
    return { remove: () => (handler = handler.filter((x) => x !== h)) };
  }) as unknown as typeof AppState.addEventListener);

  await renderAndStart();
  await feed(10, smooth);

  await act(async () => handler.forEach((h) => h('background')));
  now += 60_000;
  await act(async () => handler.forEach((h) => h('active')));
  await waitFor(() => expect(startMotion).toHaveBeenCalledTimes(2));

  sensorT += 60_000;
  await feed(3, harsh); // picking the phone back up
  expect(edge()).toBe(0);
  expect(leaf().impact).toBe(0);
});

test('while paused in the background there is no warning left showing', async () => {
  let handler: ((s: AppStateStatus) => void)[] = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_t: string, h: (s: AppStateStatus) => void) => {
    handler.push(h);
    return { remove: () => (handler = handler.filter((x) => x !== h)) };
  }) as unknown as typeof AppState.addEventListener);

  await renderAndStart();
  await feed(10, smooth);
  await feed(5, harsh);
  await waitFor(() => expect(edge()).toBeGreaterThan(0.9));

  await act(async () => handler.forEach((h) => h('background')));
  expect(edge()).toBe(0);
  expect(leaf().droop).toBe(0);
});

test('no warning is left on screen once the drive ends', async () => {
  await renderAndStart();
  await feed(10, smooth);
  await feed(5, harsh);
  await waitFor(() => expect(edge()).toBeGreaterThan(0.9));

  await fireEvent.press(screen.getByTestId('drive-stop'));
  await waitFor(() => expect(screen.getByTestId('drive-start')).toBeTruthy());
  expect(edge()).toBe(0);
  expect(leaf().droop).toBe(0);
});

test('the phone\'s reduce-motion setting reaches the leaf', async () => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
  await renderAndStart();
  await waitFor(() => expect(leaf().reduce).toBe(true));
});
