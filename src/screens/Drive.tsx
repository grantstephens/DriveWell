import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Card, Snackbar, Text, useTheme } from 'react-native-paper';

import { Leaf } from '../components/Leaf';
import { useDrive } from '../DriveContext';
import { formatClock } from '../domain/duration';
import { leafColor } from '../domain/leaf';
import { SmoothnessEngine } from '../domain/scoring';
import { computeStats } from '../domain/stats';
import { formatTimestamp } from '../domain/timestamp';
import { MIN_TRIP_SECONDS, type Trip } from '../domain/trip';
import { notify } from '../platform/confirm';
import { startMotion, type MotionSubscription } from '../platform/motion';
import type { Theme } from '../theme';

/** The tag expo-keep-awake groups this screen's lock under. */
const KEEP_AWAKE_TAG = 'drivewell-drive';

/**
 * Drive is the main screen: the leaf, live while driving, a summary once
 * stopped. Gamification lives entirely in the leaf's color and the points
 * counter — no separate "level up" ceremony to build or maintain.
 */
export function DriveScreen() {
  const { store, revision, bump, startCapture } = useDrive();
  const theme = useTheme();
  const styles = createStyles(theme);

  const [driving, setDriving] = useState(false);
  const [smoothness, setSmoothness] = useState(100);
  const [live, setLive] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [lastTrip, setLastTrip] = useState<Trip | null>(null);
  const [lifetimeAverage, setLifetimeAverage] = useState<number | null>(null);
  const [milestone, setMilestone] = useState<string | null>(null);

  const engineRef = useRef<SmoothnessEngine | null>(null);
  const subscriptionRef = useRef<MotionSubscription | null>(null);
  const startedAtRef = useRef('');

  useEffect(() => {
    let cancelled = false;
    void store.trips().then((trips) => {
      if (!cancelled) setLifetimeAverage(computeStats(trips).averageScore);
    });
    return () => {
      cancelled = true;
    };
  }, [store, revision]);

  useEffect(() => {
    if (!driving) return undefined;
    void activateKeepAwakeAsync(KEEP_AWAKE_TAG);
    return () => {
      void deactivateKeepAwake(KEEP_AWAKE_TAG);
    };
  }, [driving]);

  // Stop any live subscription on unmount — the screen never actually
  // unmounts inside the tab navigator, but a test render does.
  useEffect(() => {
    return () => {
      subscriptionRef.current?.stop();
    };
  }, []);

  async function start(): Promise<void> {
    const engine = new SmoothnessEngine();
    engineRef.current = engine;
    startedAtRef.current = formatTimestamp(new Date());
    setSmoothness(100);
    setLive(false);
    setSeconds(0);
    setLastTrip(null);
    setMilestone(null);
    setDriving(true);
    const capture = startCapture();
    try {
      subscriptionRef.current = await startMotion((sample) => {
        engine.push(sample);
        setSmoothness(engine.smoothness);
        setLive(engine.live);
        setSeconds(engine.seconds);
        capture.push({ t: sample.t, x: sample.x, y: sample.y, z: sample.z, ...engine.debugSnapshot });
      });
    } catch (err) {
      setDriving(false);
      engineRef.current = null;
      await notify(
        'No accelerometer',
        err instanceof Error ? err.message : 'This device has no accelerometer.',
      );
    }
  }

  async function stop(): Promise<void> {
    subscriptionRef.current?.stop();
    subscriptionRef.current = null;
    const engine = engineRef.current;
    engineRef.current = null;
    setDriving(false);
    if (!engine || engine.seconds < MIN_TRIP_SECONDS) return;

    const trip: Trip = {
      startedAt: startedAtRef.current,
      endedAt: formatTimestamp(new Date()),
      seconds: Math.round(engine.seconds),
      score: engine.score,
    };
    const priorBest = computeStats(await store.trips()).bestScore;
    await store.putTrip(trip);
    setLastTrip(trip);
    if (priorBest !== null && trip.score > priorBest) {
      setMilestone(`New personal best — ${Math.round(trip.score)}%`);
    }
    bump();
  }

  return (
    <View style={styles.screen} testID="drive-screen">
      <View style={styles.leafArea}>
        <Leaf
          color={driving && !live ? theme.colors.onSurfaceVariant : leafColor(smoothness)}
          smoothness={driving && !live ? 0 : smoothness}
          size={220}
        />
        <Text variant="headlineMedium" testID="drive-smoothness">
          {!driving ? 'Ready' : !live ? 'Detecting movement…' : `${smoothness}%`}
        </Text>
      </View>

      {driving ? (
        <View style={styles.stats} testID="drive-stats-driving">
          <Stat label="Elapsed" value={formatClock(seconds)} theme={theme} />
        </View>
      ) : (
        <View style={styles.stats} testID="drive-stats-idle">
          {lifetimeAverage !== null && (
            <Stat
              testID="drive-lifetime-average"
              label="Lifetime average"
              value={`${Math.round(lifetimeAverage)}%`}
              theme={theme}
            />
          )}
          {lastTrip && (
            <Stat
              testID="drive-last-trip"
              label="Last trip"
              value={`${Math.round(lastTrip.score)}%`}
              theme={theme}
            />
          )}
        </View>
      )}

      <Button
        mode="contained"
        testID={driving ? 'drive-stop' : 'drive-start'}
        onPress={() => void (driving ? stop() : start())}
        buttonColor={driving ? theme.colors.error : undefined}
        style={styles.button}
        contentStyle={styles.buttonContent}
      >
        {driving ? 'End Drive' : 'Start Drive'}
      </Button>

      <Snackbar visible={milestone !== null} onDismiss={() => setMilestone(null)} duration={3000}>
        <Text testID="drive-milestone">{milestone}</Text>
      </Snackbar>
    </View>
  );
}

function Stat({
  label,
  value,
  theme,
  testID,
}: {
  label: string;
  value: string;
  theme: Theme;
  testID?: string;
}) {
  const styles = createStyles(theme);
  return (
    <Card style={styles.stat} testID={testID}>
      <Card.Content style={styles.statContent}>
        <Text variant="headlineSmall" testID={testID ? `${testID}-value` : undefined}>
          {value}
        </Text>
        <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant, marginTop: 2 }}>
          {label}
        </Text>
      </Card.Content>
    </Card>
  );
}

function createStyles(theme: Theme) {
  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: theme.colors.background,
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 32,
      paddingHorizontal: 24,
    },
    leafArea: { alignItems: 'center', gap: 12, marginTop: 24 },
    stats: { flexDirection: 'row', gap: 16, justifyContent: 'center' },
    stat: { minWidth: 120 },
    statContent: { alignItems: 'center' },
    button: {
      width: '100%',
      borderRadius: 12,
    },
    buttonContent: { paddingVertical: 8 },
  });
}
