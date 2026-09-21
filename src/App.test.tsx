import { render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

import App from './App';
import { openNodeSqlite } from './storage/nodeSqlite';
import { SqliteStore } from './storage/SqliteStore';

jest.mock('./storage/openStore');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { openStore } = require('./storage/openStore') as { openStore: jest.Mock };

test('shows the three tabs once the store opens', async () => {
  openStore.mockResolvedValue(await SqliteStore.open(openNodeSqlite(':memory:')));
  await render(<App />);
  // Queried by testID, not text: a text query for 'Stats' risks matching
  // something a screen itself renders, where a tab button's testID cannot.
  await waitFor(() => expect(screen.getByTestId('tab-Drive')).toBeTruthy());
  expect(screen.getByTestId('tab-Stats')).toBeTruthy();
  expect(screen.getByTestId('tab-Settings')).toBeTruthy();
});

test('a store that fails to open shows an error, not a blank screen', async () => {
  openStore.mockRejectedValue(new Error('disk full'));
  await render(<App />);
  await waitFor(() => expect(screen.getByText('disk full')).toBeTruthy());
});
