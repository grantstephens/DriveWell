import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import { AppState, type AppStateStatus, Share } from 'react-native';
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
  // score is a time-weighted average over the whole 10 s, including the
  // jerk baseline's own first couple of seconds settling in from a
  // standing start — see scoring.test.ts's equivalent case for why this
  // isn't quite 99+ despite the drive itself being perfectly smooth.
  expect(trips[0]!.score).toBeGreaterThanOrEqual(98);
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
  expect(screen.queryByTestId('drive-summary')).toBeNull();
});

// Found in final review: a phone left on a table for a while racks up
// wall-clock seconds (past MIN_TRIP_SECONDS) without ever proving a
// vehicle was involved. It must not be saved — and especially must not be
// saved as a suspicious, unearned 100% now that score requires liveness.
test('a long-enough-by-the-clock but never-live "drive" is discarded, not saved as a false 100%', async () => {
  const motion = fakeMotion();
  await renderDrive(store);
  await fireEvent.press(screen.getByTestId('drive-start'));
  await waitFor(() => expect(screen.getByTestId('drive-stop')).toBeTruthy());

  // Dead-still for a full minute — never crosses the liveness bar.
  for (let i = 0; i <= 600; i++) {
    motion.push({ x: 0, y: 0, z: 1, t: i * 100 });
  }

  await fireEvent.press(screen.getByTestId('drive-stop'));
  await waitFor(() => expect(screen.getByTestId('drive-start')).toBeTruthy());

  await expect(store.trips()).resolves.toEqual([]);
  expect(screen.queryByTestId('drive-summary')).toBeNull();
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

/** Ends a smooth 10 s drive and leaves the screen on its post-drive summary. */
async function finishSmoothDrive(): Promise<void> {
  const motion = fakeMotion();
  await renderDrive(store);
  await fireEvent.press(screen.getByTestId('drive-start'));
  await waitFor(() => expect(screen.getByTestId('drive-stop')).toBeTruthy());
  for (let i = 0; i <= 100; i++) {
    motion.push({ x: 0, y: 0, z: 1 + (i % 2 === 0 ? 0.01 : -0.01), t: i * 100 });
  }
  await fireEvent.press(screen.getByTestId('drive-stop'));
  await waitFor(() => expect(screen.getByTestId('drive-start')).toBeTruthy());
}

test('ending a drive shows a braking / cornering / acceleration traffic-light summary', async () => {
  await finishSmoothDrive();

  expect(screen.getByTestId('drive-summary')).toBeTruthy();
  // A perfectly gentle drive has nothing to flag: all three lights green.
  expect(screen.getByTestId('light-braking').props.accessibilityLabel).toBe('Braking: green');
  expect(screen.getByTestId('light-cornering').props.accessibilityLabel).toBe('Cornering: green');
  expect(screen.getByTestId('light-acceleration').props.accessibilityLabel).toBe('Acceleration: green');
});

test('the summary can be shared as a Wordle-style card through the OS share sheet', async () => {
  const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction });
  await finishSmoothDrive();

  await fireEvent.press(screen.getByTestId('drive-share'));

  expect(share).toHaveBeenCalledTimes(1);
  const message = share.mock.calls[0]![0].message as string;
  expect(message).toContain('DriveWell #1');
  expect(message).toContain('🟢 Braking');
  expect(message).toContain('🟢 Cornering');
  expect(message).toContain('🟢 Acceleration');
  share.mockRestore();
});

test('the trip number counts up through the driving history', async () => {
  await store.putTrip({
    startedAt: '2026-01-01T00:00:00Z',
    endedAt: '2026-01-01T00:10:00Z',
    seconds: 600,
    score: 80,
  });
  const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction });
  await finishSmoothDrive();

  await fireEvent.press(screen.getByTestId('drive-share'));

  expect((share.mock.calls[0]![0].message as string)).toContain('DriveWell #2');
  share.mockRestore();
});

test('a share that fails surfaces a notification instead of crashing', async () => {
  const share = jest.spyOn(Share, 'share').mockRejectedValue(new Error('no share targets'));
  await finishSmoothDrive();

  await fireEvent.press(screen.getByTestId('drive-share'));

  await waitFor(() => expect(notify).toHaveBeenCalledWith('Could not share', 'no share targets'));
  share.mockRestore();
});

/**
 * A controllable stand-in for the OS telling the app it moved to the background
 * or came back. Like the real thing it tells every listener — React Native
 * Paper and friends register their own.
 */
function fakeAppState() {
  const handlers = new Set<(state: AppStateStatus) => void>();
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((
    _type: string,
    h: (state: AppStateStatus) => void,
  ) => {
    handlers.add(h);
    return { remove: () => handlers.delete(h) };
  }) as unknown as typeof AppState.addEventListener);
  return {
    /** Deliver one or more state changes back-to-back, with no chance for anything async to settle between them. */
    async go(...states: AppStateStatus[]) {
      await act(async () => {
        for (const state of states) [...handlers].forEach((h) => h(state));
      });
    },
  };
}

async function startDriving() {
  await fireEvent.press(screen.getByTestId('drive-start'));
  await waitFor(() => expect(screen.getByTestId('drive-stop')).toBeTruthy());
}

function smooth(motion: ReturnType<typeof fakeMotion>, fromMs: number, seconds: number) {
  for (let i = 0; i <= seconds * 10; i++) {
    motion.push({ x: 0, y: 0, z: 1 + (i % 2 === 0 ? 0.01 : -0.01), t: fromMs + i * 100 });
  }
}

describe('pausing while DriveWell is not on screen', () => {
  afterEach(() => jest.restoreAllMocks());

  test('leaving the screen outside a drive changes nothing', async () => {
    const app = fakeAppState();
    fakeMotion();
    await renderDrive(store);

    await app.go('background', 'active');

    expect(screen.getByTestId('drive-smoothness').props.children).toBe('Ready');
    expect(startMotion).not.toHaveBeenCalled();
  });

  test('stops reacting to the app leaving the screen once the drive has ended', async () => {
    const app = fakeAppState();
    const motion = fakeMotion();
    await renderDrive(store);
    await startDriving();
    smooth(motion, 0, 10);
    await fireEvent.press(screen.getByTestId('drive-stop'));
    await waitFor(() => expect(screen.getByTestId('drive-start')).toBeTruthy());
    const stopsSoFar = motion.stop.mock.calls.length;

    await app.go('background', 'active');

    expect(motion.stop.mock.calls.length).toBe(stopsSoFar);
    expect(startMotion).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('drive-smoothness').props.children).toBe('Ready');
  });

  test('going to the background stops the sensors and shows Paused; coming back restarts them', async () => {
    const app = fakeAppState();
    const motion = fakeMotion();
    await renderDrive(store);
    await startDriving();
    smooth(motion, 0, 3);
    expect(startMotion).toHaveBeenCalledTimes(1);

    await app.go('background');
    expect(motion.stop).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('drive-smoothness').props.children).toBe('Paused');

    await app.go('active');
    await waitFor(() => expect(startMotion).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.getByTestId('drive-smoothness').props.children).not.toBe('Paused'),
    );
  });

  test('time off screen is neither scored nor counted as driving time', async () => {
    const app = fakeAppState();
    const motion = fakeMotion();
    await renderDrive(store);
    await startDriving();
    smooth(motion, 0, 10);

    await app.go('background');
    await app.go('active');
    await waitFor(() => expect(startMotion).toHaveBeenCalledTimes(2));

    // Sensor time jumps five minutes while the app was away.
    smooth(motion, 300_000, 10);
    await fireEvent.press(screen.getByTestId('drive-stop'));
    await waitFor(() => expect(screen.getByTestId('drive-start')).toBeTruthy());

    const trips = await store.trips();
    expect(trips).toHaveLength(1);
    expect(trips[0]!.seconds).toBeGreaterThanOrEqual(18);
    expect(trips[0]!.seconds).toBeLessThan(30);
  });

  test('the post-drive summary says how long DriveWell was off screen', async () => {
    let now = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const app = fakeAppState();
    const motion = fakeMotion();
    await renderDrive(store);
    await startDriving();
    smooth(motion, 0, 10);

    await app.go('background');
    now += 92_000; // a minute and a half away
    await app.go('active');
    await waitFor(() => expect(startMotion).toHaveBeenCalledTimes(2));
    smooth(motion, 300_000, 10);
    await fireEvent.press(screen.getByTestId('drive-stop'));
    await waitFor(() => expect(screen.getByTestId('drive-start')).toBeTruthy());

    expect(screen.getByTestId('drive-off-screen').props.children).toContain('1:32');
  });

  test('no note about being off screen when it never was', async () => {
    fakeAppState();
    const motion = fakeMotion();
    await renderDrive(store);
    await startDriving();
    smooth(motion, 0, 10);
    await fireEvent.press(screen.getByTestId('drive-stop'));
    await waitFor(() => expect(screen.getByTestId('drive-start')).toBeTruthy());

    expect(screen.getByTestId('drive-summary')).toBeTruthy();
    expect(screen.queryByTestId('drive-off-screen')).toBeNull();
  });

  // Away, back, away again before the restart finished: the half-started
  // subscription must be shut down, not left running in the background.
  test('a quick away-back-away does not leak a running subscription', async () => {
    const app = fakeAppState();
    const motion = fakeMotion();
    await renderDrive(store);
    await startDriving();

    await app.go('background', 'active', 'background');
    await waitFor(() => expect(startMotion).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(motion.stop).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('drive-smoothness').props.children).toBe('Paused');
  });
});

test('the leaf changes colour as the drive gets rougher', async () => {
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
  // should drag the leaf toward red.
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
