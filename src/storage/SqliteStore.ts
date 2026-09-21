import type { Store } from '../domain/store';
import type { Trip } from '../domain/trip';
import type { SqlDatabase } from './sql';

/** The columns, in the one order every query in this file uses. */
const COLUMNS = 'startedAt, endedAt, seconds, score, points';

const PUT = `
  INSERT INTO trips (${COLUMNS})
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(startedAt) DO UPDATE SET
    endedAt = excluded.endedAt,
    seconds = excluded.seconds,
    score = excluded.score,
    points = excluded.points
`;

/** A row as SQLite hands it back, before it is trusted as a Trip. */
interface Row {
  startedAt: string;
  endedAt: string;
  seconds: number;
  score: number;
  points: number;
}
function toTrip(row: Row): Trip {
  // Copied field by field rather than spread: node:sqlite returns
  // null-prototype objects, and this keeps a plain one crossing the boundary.
  return {
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    seconds: row.seconds,
    score: row.score,
    points: row.points,
  };
}

/**
 * SqliteStore is the app's Store, one row per trip keyed by startedAt.
 *
 * startedAt is fixed-width RFC3339 UTC (see domain/timestamp.ts), so
 * `ORDER BY startedAt` is chronological with no secondary index.
 */
export class SqliteStore implements Store {
  private constructor(private readonly db: SqlDatabase) {}

  static async open(db: SqlDatabase): Promise<SqliteStore> {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS trips (
        startedAt TEXT PRIMARY KEY NOT NULL,
        endedAt   TEXT NOT NULL,
        seconds   INTEGER NOT NULL,
        score     REAL NOT NULL,
        points    INTEGER NOT NULL
      )
    `);
    return new SqliteStore(db);
  }

  async putTrip(trip: Trip): Promise<void> {
    await this.db.run(PUT, [
      trip.startedAt,
      trip.endedAt,
      trip.seconds,
      trip.score,
      trip.points,
    ]);
  }

  async trips(): Promise<Trip[]> {
    const rows = await this.db.all<Row>(
      `SELECT ${COLUMNS} FROM trips ORDER BY startedAt`,
    );
    return rows.map(toTrip);
  }

  async deleteAllTrips(): Promise<void> {
    await this.db.run('DELETE FROM trips');
  }

  async close(): Promise<void> {
    await this.db.close();
  }
}
