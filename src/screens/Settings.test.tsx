import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

import { DriveProvider } from '../DriveContext';
import type { Store } from '../domain/store';
import { openNodeSqlite } from '../storage/nodeSqlite';
import { SqliteStore } from '../storage/SqliteStore';
import { ThemeProvider } from '../ThemeContext';
import { SettingsScreen } from './Settings';

jest.mock('../platform/confirm');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { confirm, notify } = require('../platform/confirm') as {
  confirm: jest.Mock;
  notify: jest.Mock;
};

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
});
afterEach(async () => {
  await store.close();
});

async function renderSettings() {
  return render(
    <ThemeProvider>
      <DriveProvider store={store}>
        <SettingsScreen />
      </DriveProvider>
    </ThemeProvider>,
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
