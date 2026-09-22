import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Card, Text, useTheme } from 'react-native-paper';

import { useDrive } from '../DriveContext';
import { formatHoursMinutes } from '../domain/duration';
import { leafColor } from '../domain/leaf';
import { computeStats, type DriveStats } from '../domain/stats';
import type { Trip } from '../domain/trip';
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
        <Text
          variant="bodyLarge"
          style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center' }}
        >
          No drives recorded yet. Start a drive from the leaf tab to see your stats here.
        </Text>
      </View>
    );
  }

  const chartTrips = trips.slice(-CHART_TRIPS);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.grid}>
        <Metric label="Lifetime points" value={String(stats.totalPoints)} />
        <Metric label="Best drive" value={`${Math.round(stats.bestScore!)}%`} />
        <Metric label="Average score" value={`${Math.round(stats.averageScore!)}%`} />
        <Metric label="Total drives" value={String(stats.totalTrips)} />
        <Metric label="Time behind the wheel" value={formatHoursMinutes(stats.totalSeconds)} />
      </View>

      {stats.improvement !== null && (
        <Card testID="stats-improvement">
          <Card.Content>
            <Text variant="bodyMedium">{improvementText(stats.improvement)}</Text>
          </Card.Content>
        </Card>
      )}

      <Text variant="titleMedium">Recent drives</Text>
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

function Metric({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <Card style={metricCardStyle} mode="contained">
      <Card.Content>
        <Text variant="displaySmall">{value}</Text>
        <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant }}>
          {label}
        </Text>
      </Card.Content>
    </Card>
  );
}

const metricCardStyle = { width: '40%' as const };

function createStyles(theme: Theme) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.colors.background },
    content: { padding: 24, gap: 24 },
    empty: {
      flex: 1,
      backgroundColor: theme.colors.background,
      alignItems: 'center',
      justifyContent: 'center',
      padding: 32,
    },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 20 },
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
