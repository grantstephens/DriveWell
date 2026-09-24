import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import { PaperProvider } from 'react-native-paper';

import { DriveProvider } from '../DriveContext';
import type { Store } from '../domain/store';
import { openNodeSqlite } from '../storage/nodeSqlite';
import { SqliteStore } from '../storage/SqliteStore';
import { lightTheme } from '../theme';
import { DriveScreen } from './Drive';
import { SettingsScreen } from './Settings';

jest.mock('../platform/confirm');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { confirm, notify } = require('../platform/confirm') as {
  confirm: jest.Mock;
  notify: jest.Mock;
};

jest.mock('../platform/motion');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { startMotion } = require('../platform/motion') as { startMotion: jest.Mock };

jest.mock('expo-keep-awake', () => ({
  activateKeepAwakeAsync: jest.fn().mockResolvedValue(undefined),
  deactivateKeepAwake: jest.fn().mockResolvedValue(undefined),
}));

/** A fake motion source under full test control: push emits one sample. */
function fakeMotion() {
  let onSample: ((s: { x: number; y: number; z: number; t: number }) => void) | null = null;
  startMotion.mockImplementation(async (cb: typeof onSample) => {
    onSample = cb;
    return { stop: jest.fn() };
  });
  return {
    push(sample: { x: number; y: number; z: number; t: number }) {
      onSample?.(sample);
    },
  };
}

let store: Store;
beforeEach(async () => {
  store = await SqliteStore.open(openNodeSqlite(':memory:'));
  await store.putTrip({
    startedAt: '2026-09-20T08:00:00Z',
    endedAt: '2026-09-20T08:10:00Z',
    seconds: 600,
    score: 80,
    points: 40,
  });
  confirm.mockReset();
  notify.mockReset();
  notify.mockResolvedValue(undefined);
  startMotion.mockReset();
});
afterEach(async () => {
  await store.close();
});

async function renderSettings() {
  return render(
    <PaperProvider theme={lightTheme}>
      <DriveProvider store={store}>
        <SettingsScreen />
      </DriveProvider>
    </PaperProvider>
  );
}

test('declining the confirmation keeps the trips', async () => {
  confirm.mockResolvedValue(false);
  await renderSettings();
  await fireEvent.press(screen.getByTestId('settings-delete'));
  await waitFor(() => expect(confirm).toHaveBeenCalled());
  await expect(store.trips()).resolves.toHaveLength(1);
});

test('confirming deletes every trip and notifies', async () => {
  confirm.mockResolvedValue(true);
  await renderSettings();
  await fireEvent.press(screen.getByTestId('settings-delete'));
  await waitFor(() => expect(notify).toHaveBeenCalled());
  await expect(store.trips()).resolves.toEqual([]);
});

test('no export option before any drive this session', async () => {
  await renderSettings();
  expect(screen.queryByTestId('settings-export')).toBeNull();
});

test('a drive completed on the Drive screen makes "Export last drive" available on Settings, via shared context', async () => {
  const motion = fakeMotion();
  await render(
    <PaperProvider theme={lightTheme}>
      <DriveProvider store={store}>
        <DriveScreen />
        <SettingsScreen />
      </DriveProvider>
    </PaperProvider>,
  );
  expect(screen.queryByTestId('settings-export')).toBeNull();

  await fireEvent.press(screen.getByTestId('drive-start'));
  await waitFor(() => expect(screen.getByTestId('drive-stop')).toBeTruthy());

  for (let i = 0; i <= 100; i++) {
    motion.push({ x: 0, y: 0, z: 1 + (i % 2 === 0 ? 0.01 : -0.01), t: i * 100 });
  }
  await fireEvent.press(screen.getByTestId('drive-stop'));

  await waitFor(() => expect(screen.getByTestId('settings-export')).toBeTruthy());
  expect(screen.getByTestId('settings-export-text').props.children).toContain(101);
});
