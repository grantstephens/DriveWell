import type { Trip } from './trip';

/**
 * Store persists trips.
 *
 * Every method rejects with an Error rather than throwing synchronously or
 * crashing, because a failure on a user's phone must become an alert, not a
 * dead app.
 */
export interface Store {
  /**
   * putTrip writes a trip, replacing any existing trip with the same
   * startedAt (which cannot happen in practice — one engine per trip — but
   * makes retries safe).
   */
  putTrip(trip: Trip): Promise<void>;

  /** trips returns every stored trip, ascending by startedAt. */
  trips(): Promise<Trip[]>;

  /** deleteAllTrips erases the driving history. Deleting nothing is not an error. */
  deleteAllTrips(): Promise<void>;

  /** close releases the underlying resources. */
  close(): Promise<void>;
}
