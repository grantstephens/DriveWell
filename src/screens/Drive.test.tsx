import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import { PaperProvider } from 'react-native-paper';

import { DriveProvider } from '../DriveContext';
import type { Store } from '../domain/store';
import { openNodeSqlite } from '../storage/nodeSqlite';
import { SqliteStore } from '../storage/SqliteStore';
import { lightTheme } from '../theme';
import { DriveScreen } from './Drive';

jest.mock('../platform/motion');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { startMotion } = require('../platform/motion') as {
  startMotion: jest.Mock;
};

jest.mock('../platform/confirm');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { notify } = require('../platform/confirm') as { notify: jest.Mock };

jest.mock('expo-keep-awake', () => ({
  activateKeepAwakeAsync: jest.fn().mockResolvedValue(undefined),
  deactivateKeepAwake: jest.fn().mockResolvedValue(undefined),
}));

/** A fake motion source under full test control: push emits one sample. */
function fakeMotion() {
  let onSample: ((s: { x: number; y: number; z: number; t: number }) => void) | null = null;
  const stop = jest.fn();
  startMotion.mockImplementation(async (cb: typeof onSample) => {
    onSample = cb;
    return { stop };
  });
  return {
    push(sample: { x: number; y: number; z: number; t: number }) {
      onSample?.(sample);
    },
    stop,
  };
}

async function renderDrive(store: Store) {
  const view = render(
    <PaperProvider theme={lightTheme}>
      <DriveProvider store={store}>
        <DriveScreen />
      </DriveProvider>
    </PaperProvider>,
  );
  await waitFor(() => expect(screen.getByTestId('drive-screen')).toBeTruthy());
  return view;
}

let store: Store;
beforeEach(async () => {
  store = await SqliteStore.open(openNodeSqlite(':memory:'));
  startMotion.mockReset();
  notify.mockReset();
  notify.mockResolvedValue(undefined);
});
afterEach(async () => {
  await store.close();
});

test('opens ready, not driving', async () => {
  await renderDrive(store);
  expect(screen.getByTestId('drive-smoothness').props.children).toBe('Ready');
  expect(screen.getByTestId('drive-start')).toBeTruthy();
  expect(screen.queryByTestId('drive-stop')).toBeNull();
});

test('starting a drive shows a detecting state, then live smoothness once a real vehicle is confirmed', async () => {
  const motion = fakeMotion();
  await renderDrive(store);
  await fireEvent.press(screen.getByTestId('drive-start'));
  await waitFor(() => expect(screen.getByTestId('drive-stop')).toBeTruthy());

  // Before any real signal arrives, the screen does not claim a perfect
  // reading it cannot back up.
  expect(screen.getByTestId('drive-smoothness').props.children).toBe('Detecting movement…');

  // Realistic engine/road vibration (not perfectly constant — nothing real
  // ever is) is what proves a vehicle is actually involved.
  for (let i = 0; i <= 5; i++) {
    motion.push({ x: 0, y: 0, z: 1 + (i % 2 === 0 ? 0.08 : -0.08), t: i * 100 });
  }
  await waitFor(() =>
    expect(screen.getByTestId('drive-smoothness').props.children).toMatch(/^\d+%$/),
  );
});

test('ending a drive stops the subscription and persists a trip', async () => {
  const motion = fakeMotion();
  await renderDrive(store);
  await fireEvent.press(screen.getByTestId('drive-start'));
  await waitFor(() => expect(screen.getByTestId('drive-stop')).toBeTruthy());

  // 10 s of a real, smooth drive — small alternating vibration standing in
  // for the engine/road, not perfectly constant stillness (which a table
  // also produces and must not be rewarded — see scoring.test.ts).
  for (let i = 0; i <= 100; i++) {
    motion.push({ x: 0, y: 0, z: 1 + (i % 2 === 0 ? 0.01 : -0.01), t: i * 100 });
  }

  await fireEvent.press(screen.getByTestId('drive-stop'));
  await waitFor(() => expect(screen.getByTestId('drive-start')).toBeTruthy());

  expect(motion.stop).toHaveBeenCalled();
  const trips = await store.trips();
  expect(trips).toHaveLength(1);
  expect(trips[0]!.score).toBeGreaterThanOrEqual(99);
});

test('the idle screen shows a lifetime average, not points, and the last trip has no points suffix', async () => {
  await store.putTrip({
    startedAt: '2026-01-01T00:00:00Z',
    endedAt: '2026-01-01T00:10:00Z',
    seconds: 600,
    score: 70,
  });
  const motion = fakeMotion();
  await renderDrive(store);

  await waitFor(() => expect(screen.getByTestId('drive-lifetime-average')).toBeTruthy());
  expect(screen.getByTestId('drive-lifetime-average-value').props.children).toBe('70%');

  await fireEvent.press(screen.getByTestId('drive-start'));
  await waitFor(() => expect(screen.getByTestId('drive-stop')).toBeTruthy());
  for (let i = 0; i <= 100; i++) {
    motion.push({ x: 0, y: 0, z: 1 + (i % 2 === 0 ? 0.01 : -0.01), t: i * 100 });
  }
  await fireEvent.press(screen.getByTestId('drive-stop'));
  await waitFor(() => expect(screen.getByTestId('drive-start')).toBeTruthy());

  const lastTripValue = screen.getByTestId('drive-last-trip-value').props.children;
  expect(lastTripValue).toMatch(/^\d+%$/);
});

test('a trip shorter than the minimum is discarded, not saved', async () => {
  const motion = fakeMotion();
  await renderDrive(store);
  await fireEvent.press(screen.getByTestId('drive-start'));
  await waitFor(() => expect(screen.getByTestId('drive-stop')).toBeTruthy());

  motion.push({ x: 0, y: 0, z: 1, t: 0 });
  motion.push({ x: 0, y: 0, z: 1, t: 500 }); // half a second — below MIN_TRIP_SECONDS

  await fireEvent.press(screen.getByTestId('drive-stop'));
  await waitFor(() => expect(screen.getByTestId('drive-start')).toBeTruthy());

  await expect(store.trips()).resolves.toEqual([]);
});

test('a missing accelerometer surfaces a notification instead of crashing', async () => {
  startMotion.mockRejectedValue(new Error('No accelerometer on this device'));
  await renderDrive(store);
  await fireEvent.press(screen.getByTestId('drive-start'));

  await waitFor(() => expect(notify).toHaveBeenCalled());
  expect(screen.getByTestId('drive-start')).toBeTruthy();
});

/** @expo/vector-icons folds its `color` prop into style[0].color, not a
 * literal `color` prop on the rendered element. */
function leafFill(): string {
  return screen.getByTestId('leaf-path').props.style[0].color;
}

test('beating your prior best score shows a personal-best toast', async () => {
  // Seed one prior trip to beat.
  await store.putTrip({
    startedAt: '2026-01-01T00:00:00Z',
    endedAt: '2026-01-01T00:01:00Z',
    seconds: 60,
    score: 50,
  });

  const motion = fakeMotion();
  await renderDrive(store);
  await fireEvent.press(screen.getByTestId('drive-start'));
  await waitFor(() => expect(screen.getByTestId('drive-stop')).toBeTruthy());

  // 10 s of a real, smooth drive — comfortably beats the seeded 50.
  for (let i = 0; i <= 100; i++) {
    motion.push({ x: 0, y: 0, z: 1 + (i % 2 === 0 ? 0.01 : -0.01), t: i * 100 });
  }

  await fireEvent.press(screen.getByTestId('drive-stop'));
  await waitFor(() => expect(screen.getByTestId('drive-milestone')).toBeTruthy());
  expect(screen.getByTestId('drive-milestone').props.children).toMatch(/personal best/i);
});

test('a trip that does not beat the prior best shows no toast', async () => {
  await store.putTrip({
    startedAt: '2026-01-01T00:00:00Z',
    endedAt: '2026-01-01T00:01:00Z',
    seconds: 60,
    score: 100,
  });

  const motion = fakeMotion();
  await renderDrive(store);
  await fireEvent.press(screen.getByTestId('drive-start'));
  await waitFor(() => expect(screen.getByTestId('drive-stop')).toBeTruthy());

  for (let i = 0; i <= 100; i++) {
    motion.push({ x: 0, y: 0, z: 1 + (i % 2 === 0 ? 0.01 : -0.01), t: i * 100 });
  }

  await fireEvent.press(screen.getByTestId('drive-stop'));
  await waitFor(() => expect(screen.getByTestId('drive-start')).toBeTruthy());
  expect(screen.queryByTestId('drive-milestone')).toBeNull();
});

test('a first-ever trip shows no personal-best toast — there is no prior record to beat', async () => {
  const motion = fakeMotion();
  await renderDrive(store);
  await fireEvent.press(screen.getByTestId('drive-start'));
  await waitFor(() => expect(screen.getByTestId('drive-stop')).toBeTruthy());

  for (let i = 0; i <= 100; i++) {
    motion.push({ x: 0, y: 0, z: 1 + (i % 2 === 0 ? 0.01 : -0.01), t: i * 100 });
  }

  await fireEvent.press(screen.getByTestId('drive-stop'));
  await waitFor(() => expect(screen.getByTestId('drive-start')).toBeTruthy());
  expect(screen.queryByTestId('drive-milestone')).toBeNull();
});

test('the leaf turns brown as the drive gets rougher', async () => {
  const motion = fakeMotion();
  await renderDrive(store);
  await fireEvent.press(screen.getByTestId('drive-start'));
  await waitFor(() => expect(screen.getByTestId('drive-stop')).toBeTruthy());

  // Establish a genuine, confirmed-live green baseline first — the leaf
  // starts each drive in a neutral "detecting" tint, not green.
  for (let i = 0; i <= 5; i++) {
    motion.push({ x: 0, y: 0, z: 1 + (i % 2 === 0 ? 0.08 : -0.08), t: i * 100 });
  }
  await waitFor(() =>
    expect(screen.getByTestId('drive-smoothness').props.children).toMatch(/^\d+%$/),
  );
  const greenFill = leafFill();

  // A realistic panic-stop-grade brake (1 g ramping in over 1 s, then held)
  // should drag the leaf toward brown.
  for (let i = 6; i <= 16; i++) {
    motion.push({ x: 1 + 1.0 * ((i - 6) / 10), y: 0, z: 0, t: i * 100 });
  }
  for (let i = 17; i <= 36; i++) {
    motion.push({ x: 2, y: 0, z: 0, t: i * 100 });
  }
  await waitFor(() => {
    expect(leafFill()).not.toBe(greenFill);
  });
});
