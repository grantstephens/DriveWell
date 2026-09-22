import { render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import { PaperProvider } from 'react-native-paper';

import { DriveProvider } from '../DriveContext';
import type { Trip } from '../domain/trip';
import type { Store } from '../domain/store';
import { openNodeSqlite } from '../storage/nodeSqlite';
import { SqliteStore } from '../storage/SqliteStore';
import { lightTheme } from '../theme';
import { improvementText, StatsScreen } from './Stats';

function trip(startedAt: string, score: number, points: number, seconds = 600): Trip {
  return { startedAt, endedAt: startedAt, seconds, score, points };
}

async function renderStats(store: Store) {
  return render(
    <PaperProvider theme={lightTheme}>
      <DriveProvider store={store}>
        <StatsScreen />
      </DriveProvider>
    </PaperProvider>
  );
}

let store: Store;
beforeEach(async () => {
  store = await SqliteStore.open(openNodeSqlite(':memory:'));
});
afterEach(async () => {
  await store.close();
});

test('shows an empty state before any drive is recorded', async () => {
  await renderStats(store);
  await waitFor(() => expect(screen.getByTestId('stats-empty')).toBeTruthy());
});

test('shows lifetime totals once trips exist', async () => {
  await store.putTrip(trip('2026-09-19T08:00:00Z', 60, 10));
  await store.putTrip(trip('2026-09-20T08:00:00Z', 90, 40));
  await renderStats(store);

  await waitFor(() => expect(screen.getByText('50')).toBeTruthy()); // total points
  expect(screen.getByText('90%')).toBeTruthy(); // best drive
  expect(screen.getByText('2')).toBeTruthy(); // total drives
});

test('renders one bar per recent trip', async () => {
  for (let i = 0; i < 7; i++) {
    await store.putTrip(trip(`2026-09-1${i}T08:00:00Z`, 70, 5));
  }
  await renderStats(store);
  await waitFor(() => expect(screen.getByTestId('stats-chart')).toBeTruthy());
  expect(screen.getByTestId('stats-chart').props.children).toHaveLength(7);
});

test('improvement only appears once an earlier window exists', async () => {
  await store.putTrip(trip('2026-09-19T08:00:00Z', 60, 10));
  await renderStats(store);
  await waitFor(() => expect(screen.getByText('1')).toBeTruthy()); // total drives rendered
  expect(screen.queryByTestId('stats-improvement')).toBeNull();
});

test('improvementText reads as plain language in both directions', () => {
  expect(improvementText(20)).toMatch(/up 20/i);
  expect(improvementText(-15)).toMatch(/down 15/i);
  expect(improvementText(0)).toMatch(/steady/i);
});
