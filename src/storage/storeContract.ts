import { SqliteStore } from './SqliteStore';
import type { SqlDatabase } from './sql';
import type { Store } from '../domain/store';
import type { Trip } from '../domain/trip';

function trip(startedAt: string, score = 75, seconds = 600): Trip {
  return {
    startedAt,
    endedAt: startedAt.replace('T12:00:00Z', 'T12:10:00Z'),
    seconds,
    score,
  };
}

/**
 * runStoreContract executes the full behavioural contract against stores
 * produced by newStore. Each test gets a fresh, empty store.
 */
export function runStoreContract(name: string, newStore: () => Promise<Store>): void {
  describe(name, () => {
    let store: Store;

    beforeEach(async () => {
      store = await newStore();
    });

    afterEach(async () => {
      await store.close();
    });

    test('trips is empty for an empty store', async () => {
      await expect(store.trips()).resolves.toEqual([]);
    });

    test('putTrip then trips round-trips every field', async () => {
      const t = trip('2026-09-20T08:00:00Z', 88.5, 1900);
      await store.putTrip(t);
      await expect(store.trips()).resolves.toEqual([t]);
    });

    test('trips come back ascending by startedAt regardless of write order', async () => {
      await store.putTrip(trip('2026-09-21T08:00:00Z'));
      await store.putTrip(trip('2026-09-19T08:00:00Z'));
      await store.putTrip(trip('2026-09-20T08:00:00Z'));
      const dates = (await store.trips()).map((t) => t.startedAt);
      expect(dates).toEqual([
        '2026-09-19T08:00:00Z',
        '2026-09-20T08:00:00Z',
        '2026-09-21T08:00:00Z',
      ]);
    });

    test('putTrip with the same startedAt replaces rather than duplicating', async () => {
      await store.putTrip(trip('2026-09-20T08:00:00Z', 50, 300));
      await store.putTrip(trip('2026-09-20T08:00:00Z', 90, 1200));
      const all = await store.trips();
      expect(all).toHaveLength(1);
      expect(all[0]!.score).toBe(90);
    });

    test('a score with full floating-point precision survives storage', async () => {
      await store.putTrip(trip('2026-09-20T08:00:00Z', 87.324159, 60));
      expect((await store.trips())[0]!.score).toBeCloseTo(87.324159, 10);
    });

    test('deleteAllTrips erases every trip', async () => {
      await store.putTrip(trip('2026-09-19T08:00:00Z'));
      await store.putTrip(trip('2026-09-20T08:00:00Z'));
      await store.deleteAllTrips();
      await expect(store.trips()).resolves.toEqual([]);
    });

    test('deleteAllTrips on an empty store is not an error', async () => {
      await expect(store.deleteAllTrips()).resolves.toBeUndefined();
    });

    test('trips still works after deleteAllTrips and a fresh putTrip', async () => {
      await store.putTrip(trip('2026-09-19T08:00:00Z'));
      await store.deleteAllTrips();
      const t = trip('2026-09-22T08:00:00Z');
      await store.putTrip(t);
      await expect(store.trips()).resolves.toEqual([t]);
    });
  });
}

/**
 * runMigrationContract proves SqliteStore.open() migrates an existing
 * old-schema database (with a NOT NULL points column) cleanly, rather than
 * throwing a constraint violation on the next write — a real crash-shaped
 * bug for anyone with an on-device database from before points was removed.
 */
export function runMigrationContract(name: string, newRawDb: () => Promise<SqlDatabase>): void {
  describe(`${name} (points-column migration)`, () => {
    test('opens and writes cleanly against a pre-existing points-era database', async () => {
      const raw = await newRawDb();
      await raw.exec(`
        CREATE TABLE trips (
          startedAt TEXT PRIMARY KEY NOT NULL,
          endedAt   TEXT NOT NULL,
          seconds   INTEGER NOT NULL,
          score     REAL NOT NULL,
          points    INTEGER NOT NULL
        )
      `);
      await raw.run(
        'INSERT INTO trips (startedAt, endedAt, seconds, score, points) VALUES (?, ?, ?, ?, ?)',
        ['2026-09-20T08:00:00Z', '2026-09-20T08:10:00Z', 600, 75, 40],
      );

      const store = await SqliteStore.open(raw);
      const existing = await store.trips();
      expect(existing).toEqual([
        { startedAt: '2026-09-20T08:00:00Z', endedAt: '2026-09-20T08:10:00Z', seconds: 600, score: 75 },
      ]);

      // The real crash this guards against: writing a new trip after
      // opening a migrated old-schema database must not hit a NOT NULL
      // constraint on the now-removed points column.
      await store.putTrip({
        startedAt: '2026-09-21T08:00:00Z',
        endedAt: '2026-09-21T08:10:00Z',
        seconds: 300,
        score: 90,
      });
      await expect(store.trips()).resolves.toHaveLength(2);
      await store.close();
    });
  });
}
