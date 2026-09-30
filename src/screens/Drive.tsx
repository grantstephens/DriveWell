import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, Share, StyleSheet, View } from 'react-native';
import { Button, Card, Snackbar, Text, useTheme } from 'react-native-paper';

import { Leaf } from '../components/Leaf';
import { TrafficLights } from '../components/TrafficLights';
import { useDrive } from '../DriveContext';
import { DriveBreakdown, type Breakdown } from '../domain/breakdown';
import { formatClock } from '../domain/duration';
import { leafColor } from '../domain/leaf';
import { SmoothnessEngine } from '../domain/scoring';
import { formatShareText } from '../domain/share';
import { computeStats } from '../domain/stats';
import { formatTimestamp } from '../domain/timestamp';
import { isDriveWorthSaving, type Trip } from '../domain/trip';
import { notify } from '../platform/confirm';
import { startMotion, type MotionSubscription } from '../platform/motion';
import type { Theme } from '../theme';

/** The tag expo-keep-awake groups this screen's lock under. */
const KEEP_AWAKE_TAG = 'drivewell-drive';

/**
 * How often the leaf actually repaints, milliseconds — deliberately far
 * below the accelerometer's own rate. A repaint redraws Leaf's native SVG
 * radial gradient, real work that (measured via a real drive's debug
 * capture) was expensive enough at 50 Hz to bottleneck the JS thread and
 * starve the accelerometer listener itself: the capture showed the
 * *engine's* effective sample rate collapsing to a sustained ~5 Hz instead
 * of the requested 50 Hz for long stretches, undersampling real harsh
 * braking/acceleration events into invisibility. `engine.push` and
 * `capture.push` below still run on every raw sample — only the
 * setState-triggered repaint is throttled.
 */
const UI_REFRESH_MS = 100;

/**
 * Drive is the main screen: the leaf, live while driving, a summary once
 * stopped. Gamification lives entirely in the leaf's color and the live
 * percentage score — no separate "level up" ceremony to build or maintain.
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
  const [summary, setSummary] = useState<{ breakdown: Breakdown; tripNumber: number } | null>(null);

  const engineRef = useRef<SmoothnessEngine | null>(null);
  const breakdownRef = useRef<DriveBreakdown | null>(null);
  const subscriptionRef = useRef<MotionSubscription | null>(null);
  const startedAtRef = useRef('');
  const lastUiUpdateRef = useRef(0);
  const uiFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      if (uiFlushTimerRef.current !== null) {
        clearTimeout(uiFlushTimerRef.current);
        uiFlushTimerRef.current = null;
      }
    };
  }, []);

  async function start(): Promise<void> {
    const engine = new SmoothnessEngine();
    engineRef.current = engine;
    const breakdown = new DriveBreakdown();
    breakdownRef.current = breakdown;
    startedAtRef.current = formatTimestamp(new Date());
    setSmoothness(100);
    setLive(false);
    setSeconds(0);
    setLastTrip(null);
    setMilestone(null);
    setSummary(null);
    setDriving(true);
    lastUiUpdateRef.current = 0;
    if (uiFlushTimerRef.current !== null) {
      clearTimeout(uiFlushTimerRef.current);
      uiFlushTimerRef.current = null;
    }
    const capture = startCapture();
    const flushUi = () => {
      lastUiUpdateRef.current = Date.now();
      setSmoothness(engine.smoothness);
      setLive(engine.live);
      setSeconds(engine.seconds);
    };
    try {
      subscriptionRef.current = await startMotion((sample) => {
        engine.push(sample);
        breakdown.push(sample);
        capture.push({
          t: sample.t,
          x: sample.x,
          y: sample.y,
          z: sample.z,
          gx: sample.gx,
          gy: sample.gy,
          gz: sample.gz,
          ...engine.debugSnapshot,
        });

        const elapsed = Date.now() - lastUiUpdateRef.current;
        if (elapsed >= UI_REFRESH_MS) {
          if (uiFlushTimerRef.current !== null) {
            clearTimeout(uiFlushTimerRef.current);
            uiFlushTimerRef.current = null;
          }
          flushUi();
        } else if (uiFlushTimerRef.current === null) {
          uiFlushTimerRef.current = setTimeout(() => {
            uiFlushTimerRef.current = null;
            flushUi();
          }, UI_REFRESH_MS - elapsed);
        }
      });
    } catch (err) {
      setDriving(false);
      engineRef.current = null;
      breakdownRef.current = null;
      await notify(
        'No accelerometer',
        err instanceof Error ? err.message : 'This device has no accelerometer.',
      );
    }
  }

  async function stop(): Promise<void> {
    subscriptionRef.current?.stop();
    subscriptionRef.current = null;
    if (uiFlushTimerRef.current !== null) {
      clearTimeout(uiFlushTimerRef.current);
      uiFlushTimerRef.current = null;
    }
    const engine = engineRef.current;
    engineRef.current = null;
    const breakdown = breakdownRef.current?.result() ?? null;
    breakdownRef.current = null;
    setDriving(false);
    if (!engine || !isDriveWorthSaving(engine.seconds, engine.liveSeconds)) return;

    const trip: Trip = {
      startedAt: startedAtRef.current,
      endedAt: formatTimestamp(new Date()),
      seconds: Math.round(engine.seconds),
      score: engine.score,
    };
    const priorTrips = await store.trips();
    const priorBest = computeStats(priorTrips).bestScore;
    await store.putTrip(trip);
    setLastTrip(trip);
    setSummary(breakdown ? { breakdown, tripNumber: priorTrips.length + 1 } : null);
    if (priorBest !== null && trip.score > priorBest) {
      setMilestone(`New personal best — ${Math.round(trip.score)}%`);
    }
    bump();
  }

  async function share(): Promise<void> {
    if (!lastTrip || !summary) return;
    try {
      await Share.share({
        message: formatShareText({
          tripNumber: summary.tripNumber,
          score: lastTrip.score,
          breakdown: summary.breakdown,
        }),
      });
    } catch (err) {
      await notify('Could not share', err instanceof Error ? err.message : 'Sharing failed.');
    }
  }

  return (
    <View style={styles.root} testID="drive-screen">
      <ScrollView contentContainerStyle={styles.screen}>
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

        {!driving && lastTrip && summary && (
          <Card style={styles.summary} testID="drive-summary">
            <Card.Content style={styles.summaryContent}>
              <Text variant="titleSmall">{`Trip #${summary.tripNumber}`}</Text>
              <TrafficLights breakdown={summary.breakdown} />
              <Button mode="outlined" icon="share-variant" onPress={() => void share()} testID="drive-share">
                Share
              </Button>
            </Card.Content>
          </Card>
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
      </ScrollView>

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
    root: { flex: 1, backgroundColor: theme.colors.background },
    screen: {
      flexGrow: 1,
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 16,
      paddingVertical: 32,
      paddingHorizontal: 24,
    },
    summary: { width: '100%' },
    summaryContent: { alignItems: 'center', gap: 16 },
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
