/**
 * Trip timestamps are RFC3339 UTC with no fractional seconds, everywhere:
 * storage, and any future export. Lexicographic order on the result is
 * chronological order, which is what makes startedAt usable as a primary key
 * without a secondary index.
 */
export function formatTimestamp(d: Date): string {
  return d.toISOString().replace(/\.\d+Z$/, 'Z');
}
