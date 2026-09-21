import { SqliteStore } from './SqliteStore';
import { openNodeSqlite } from './nodeSqlite';
import { runStoreContract } from './storeContract';

// The shared behavioural contract, run against real SQLite via node:sqlite —
// the whole point of the SqlDatabase seam. expo-sqlite on device runs the
// identical queries through the identical store code.
runStoreContract('SqliteStore (node:sqlite)', () =>
  SqliteStore.open(openNodeSqlite(':memory:')),
);

// Fault injection the shared contract cannot express: a write that fails
// mid-flight must not leave a phantom trip readable afterwards.
test('SqliteStore: a failed putTrip leaves no trace', async () => {
  const store = await SqliteStore.open(openNodeSqlite(':memory:'));
  try {
    await expect(
      store.putTrip({
        // startedAt is the NOT NULL primary key: null makes the write fail
        // where no amount of odd numbers can (SQLite coerces those).
        startedAt: null as unknown as string,
        endedAt: '2026-09-20T08:10:00Z',
        seconds: 600,
        score: 80,
        points: 10,
      }),
    ).rejects.toThrow();
    await expect(store.trips()).resolves.toEqual([]);
  } finally {
    await store.close();
  }
});
