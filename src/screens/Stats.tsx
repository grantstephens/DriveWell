import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { useDrive } from '../DriveContext';
import { formatHoursMinutes } from '../domain/duration';
import { leafColor } from '../domain/leaf';
import { computeStats, type DriveStats } from '../domain/stats';
import type { Trip } from '../domain/trip';
import { useTheme } from '../ThemeContext';
import type { Theme } from '../theme';

const EMPTY_STATS: DriveStats = {
  totalTrips: 0,
  totalPoints: 0,
  totalSeconds: 0,
  bestScore: null,
  averageScore: null,
  recentAverage: null,
  earlierAverage: null,
  improvement: null,
};

/** How many of the most recent trips the bar chart shows. */
const CHART_TRIPS = 20;

/** improvementText turns the raw number into a plain-language headline. */
export function improvementText(improvement: number): string {
  const rounded = Math.round(Math.abs(improvement));
  if (rounded === 0) return 'Holding steady over your last 5 drives.';
  return improvement > 0
    ? `Up ${rounded} points over your last 5 drives — smoother driving.`
    : `Down ${rounded} points over your last 5 drives.`;
}

/**
 * Stats is the numbers screen: lifetime totals, your best drive, and the
 * trend that answers "am I actually getting better at this".
 */
export function StatsScreen() {
  const { store, revision } = useDrive();
  const theme = useTheme();
  const styles = createStyles(theme);
  const [stats, setStats] = useState<DriveStats>(EMPTY_STATS);
  const [trips, setTrips] = useState<Trip[]>([]);

  useEffect(() => {
    let cancelled = false;
    void store.trips().then((all) => {
      if (cancelled) return;
      setTrips(all);
      setStats(computeStats(all));
    });
    return () => {
      cancelled = true;
    };
  }, [store, revision]);

  if (stats.totalTrips === 0) {
    return (
      <View style={styles.empty} testID="stats-empty">
        <Text style={styles.emptyText}>
          No drives recorded yet. Start a drive from the leaf tab to see your stats here.
        </Text>
      </View>
    );
  }

  const chartTrips = trips.slice(-CHART_TRIPS);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.grid}>
        <Metric label="Lifetime points" value={String(stats.totalPoints)} theme={theme} />
        <Metric label="Best drive" value={`${Math.round(stats.bestScore!)}%`} theme={theme} />
        <Metric
          label="Average score"
          value={`${Math.round(stats.averageScore!)}%`}
          theme={theme}
        />
        <Metric label="Total drives" value={String(stats.totalTrips)} theme={theme} />
        <Metric
          label="Time behind the wheel"
          value={formatHoursMinutes(stats.totalSeconds)}
          theme={theme}
        />
      </View>

      {stats.improvement !== null && (
        <Text style={styles.improvement} testID="stats-improvement">
          {improvementText(stats.improvement)}
        </Text>
      )}

      <Text style={styles.chartTitle}>Recent drives</Text>
      <View style={styles.chart} testID="stats-chart">
        {chartTrips.map((trip) => (
          <View key={trip.startedAt} style={styles.barTrack}>
            <View
              style={[
                styles.bar,
                { height: `${Math.max(4, trip.score)}%`, backgroundColor: leafColor(trip.score) },
              ]}
            />
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function Metric({ label, value, theme }: { label: string; value: string; theme: Theme }) {
  const styles = createStyles(theme);
  return (
    <View style={styles.metric}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function createStyles(theme: Theme) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.background },
    content: { padding: 24, gap: 24 },
    empty: {
      flex: 1,
      backgroundColor: theme.background,
      alignItems: 'center',
      justifyContent: 'center',
      padding: 32,
    },
    emptyText: { color: theme.textMuted, fontSize: 16, textAlign: 'center' },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 20 },
    metric: { width: '40%' },
    metricValue: { fontSize: 24, fontWeight: '700', color: theme.text },
    metricLabel: { fontSize: 13, color: theme.textMuted, marginTop: 2 },
    improvement: { fontSize: 15, color: theme.text, backgroundColor: theme.surface, padding: 12, borderRadius: 10 },
    chartTitle: { fontSize: 15, fontWeight: '700', color: theme.text },
    chart: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: 4,
      height: 100,
    },
    barTrack: { flex: 1, height: '100%', justifyContent: 'flex-end' },
    bar: { width: '100%', borderRadius: 3, minHeight: 4 },
  });
}
