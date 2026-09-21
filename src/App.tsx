import { Ionicons } from '@expo/vector-icons';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { NavigationContainer, type Theme as NavigationTheme } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { DriveProvider } from './DriveContext';
import { DriveScreen } from './screens/Drive';
import { SettingsScreen } from './screens/Settings';
import { StatsScreen } from './screens/Stats';
import type { Store } from './domain/store';
import { openStore } from './storage/openStore';
import { ThemeProvider, useTheme } from './ThemeContext';
import type { Theme } from './theme';

/** navigationTheme adapts our tokens to react-navigation's own Theme shape. */
function navigationTheme(theme: Theme): NavigationTheme {
  return {
    dark: theme.dark,
    colors: {
      primary: theme.accent,
      background: theme.background,
      card: theme.surface,
      text: theme.text,
      border: theme.border,
      notification: theme.accent,
    },
    fonts: {
      regular: { fontFamily: 'System', fontWeight: '400' },
      medium: { fontFamily: 'System', fontWeight: '500' },
      bold: { fontFamily: 'System', fontWeight: '700' },
      heavy: { fontFamily: 'System', fontWeight: '900' },
    },
  };
}

type TabName = 'Drive' | 'Stats' | 'Settings';

const Tab = createBottomTabNavigator();

const TAB_ICONS: Record<TabName, keyof typeof Ionicons.glyphMap> = {
  Drive: 'leaf-outline',
  Stats: 'stats-chart-outline',
  Settings: 'settings-outline',
};

/**
 * Screens render with headerShown: false, so nothing else pads the status bar
 * / camera-cutout area away from a screen's own content.
 */
function withTopInset<P extends object>(Screen: React.ComponentType<P>) {
  return function ScreenWithTopInset(props: P) {
    const theme = useTheme();
    return (
      <SafeAreaView
        edges={['top']}
        style={[styles.safeArea, { backgroundColor: theme.background }]}
      >
        <Screen {...props} />
      </SafeAreaView>
    );
  };
}

export default function App() {
  return (
    <ThemeProvider>
      <AppInner />
    </ThemeProvider>
  );
}

/**
 * Split from App so it can call useTheme() — the provider it needs has to be
 * an ancestor, not itself.
 */
function AppInner() {
  const theme = useTheme();
  const [store, setStore] = useState<Store | null>(null);
  const [failure, setFailure] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    openStore().then(
      (opened) => {
        if (cancelled) {
          // .catch, not void: void discards the value, not the rejection, and
          // an unhandled rejection here would be a crash on a fast unmount.
          opened.close().catch(() => {});
          return;
        }
        setStore(opened);
      },
      (err: unknown) => {
        if (!cancelled) setFailure(err as Error);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const statusBarStyle = theme.dark ? 'light' : 'dark';

  if (failure !== null) {
    return (
      <>
        <StatusBar style={statusBarStyle} />
        <ErrorScreen error={failure} theme={theme} />
      </>
    );
  }
  if (store === null) {
    return (
      <>
        <StatusBar style={statusBarStyle} />
        <View style={[styles.centre, { backgroundColor: theme.background }]}>
          <ActivityIndicator color={theme.accent} />
        </View>
      </>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style={statusBarStyle} />
      <DriveProvider store={store}>
        <NavigationContainer theme={navigationTheme(theme)}>
          <Tabs />
        </NavigationContainer>
      </DriveProvider>
    </SafeAreaProvider>
  );
}

function Tabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarIcon: ({ color, size }) => (
          <Ionicons name={TAB_ICONS[route.name as TabName]} color={color} size={size} />
        ),
      })}
    >
      <Tab.Screen
        name="Drive"
        component={withTopInset(DriveScreen)}
        options={{ tabBarButtonTestID: 'tab-Drive' }}
      />
      <Tab.Screen
        name="Stats"
        component={withTopInset(StatsScreen)}
        options={{ tabBarButtonTestID: 'tab-Stats' }}
      />
      <Tab.Screen
        name="Settings"
        component={withTopInset(SettingsScreen)}
        options={{ tabBarButtonTestID: 'tab-Settings' }}
      />
    </Tab.Navigator>
  );
}

function ErrorScreen({ error, theme }: { error: Error; theme: Theme }) {
  return (
    <View style={[styles.centre, { backgroundColor: theme.background }]}>
      <Text style={[styles.errorTitle, { color: theme.text }]}>Could not open your data</Text>
      <Text style={[styles.errorBody, { color: theme.text }]}>{error.message}</Text>
      <Text style={[styles.errorBody, { color: theme.textMuted }]}>
        Your driving history is still on this device. Restarting the app is usually enough.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  errorTitle: { fontSize: 18, fontWeight: 'bold', marginBottom: 12, textAlign: 'center' },
  errorBody: { textAlign: 'center', marginBottom: 8 },
});
