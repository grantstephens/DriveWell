/**
 * TEMPORARY — a throwaway diagnostic tool for calibrating scoring.ts against
 * a real motorway drive (a synthetic-vibration model was wrong: see the
 * motorway-floor bug this exists to diagnose). Delete this whole directory,
 * its wiring in Drive.tsx, and SmoothnessEngine.debugSnapshot once that
 * diagnosis is done — none of this ships.
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
