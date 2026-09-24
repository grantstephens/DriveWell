/**
 * Capture buffers one drive's raw accelerometer samples plus
 * SmoothnessEngine's internal state (see scoring.ts's `debugSnapshot`), for
 * export via Settings' "Export last drive" action. This exists for
 * debugging and algorithm-tuning — e.g. it's what surfaced the motorway
 * vibration-vs-harsh-driving miscalibration in the first place — not as a
 * trip-history export/import feature (see AGENTS.md's "no CSV
 * export/import" simplification, a different, deliberately out-of-scope
 * thing: reconciling stored trip summaries across devices).
 *
 * Scoped to the current app session's most recent drive, in memory only —
 * not persisted, so this never grows the on-device storage footprint.
 */
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

export interface CaptureRow {
  t: number;
  x: number;
  y: number;
  z: number;
  filteredMag: number | null;
  jerkEma: number;
  dynEma: number;
  activityEma: number;
  smoothness: number;
  live: boolean;
}

export class Capture {
  private rows: CaptureRow[] = [];

  push(row: CaptureRow): void {
    this.rows.push(row);
  }

  get count(): number {
    return this.rows.length;
  }

  /** exportAndShare writes the buffered rows to a JSON file and opens the OS share sheet. */
  async exportAndShare(): Promise<void> {
    const file = new File(Paths.document, `drivewell-debug-${Date.now()}.json`);
    file.create();
    file.write(JSON.stringify(this.rows));
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(file.uri);
    }
  }
}
