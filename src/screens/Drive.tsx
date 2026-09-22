import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Card, Text, useTheme } from 'react-native-paper';

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
  const { store, revision, bump } = useDrive();
  const theme = useTheme();
  const styles = createStyles(theme);

  const [driving, setDriving] = useState(false);
  const [smoothness, setSmoothness] = useState(100);
  const [live, setLive] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [points, setPoints] = useState(0);
  const [lastTrip, setLastTrip] = useState<Trip | null>(null);
  const [lifetimePoints, setLifetimePoints] = useState(0);

  const engineRef = useRef<SmoothnessEngine | null>(null);
  const subscriptionRef = useRef<MotionSubscription | null>(null);
  const startedAtRef = useRef('');

  useEffect(() => {
    let cancelled = false;
    void store.trips().then((trips) => {
      if (!cancelled) setLifetimePoints(computeStats(trips).totalPoints);
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
    setPoints(0);
    setLastTrip(null);
    setDriving(true);
    try {
      subscriptionRef.current = await startMotion((sample) => {
        engine.push(sample);
        setSmoothness(engine.smoothness);
        setLive(engine.live);
        setSeconds(engine.seconds);
        setPoints(engine.points);
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
      points: engine.points,
    };
    await store.putTrip(trip);
    setLastTrip(trip);
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
        <View style={styles.stats}>
          <Stat label="Elapsed" value={formatClock(seconds)} theme={theme} />
          <Stat label="Points this drive" value={String(points)} theme={theme} />
        </View>
      ) : (
        <View style={styles.stats}>
          <Stat label="Lifetime points" value={String(lifetimePoints)} theme={theme} />
          {lastTrip && (
            <Stat
              label="Last trip"
              value={`${Math.round(lastTrip.score)}% · +${lastTrip.points} pts`}
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
    </View>
  );
}

function Stat({ label, value, theme }: { label: string; value: string; theme: Theme }) {
  const styles = createStyles(theme);
  return (
    <Card style={styles.stat}>
      <Card.Content style={styles.statContent}>
        <Text variant="headlineSmall">{value}</Text>
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
