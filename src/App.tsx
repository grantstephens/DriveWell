import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import {
  CommonActions,
  DarkTheme as NavigationDarkTheme,
  DefaultTheme as NavigationDefaultTheme,
  NavigationContainer,
} from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { StyleSheet, useColorScheme, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import {
  ActivityIndicator,
  adaptNavigationTheme,
  BottomNavigation,
  PaperProvider,
  Text,
} from 'react-native-paper';

import { DriveProvider } from './DriveContext';
import type { Store } from './domain/store';
import { DriveScreen } from './screens/Drive';
import { SettingsScreen } from './screens/Settings';
import { StatsScreen } from './screens/Stats';
import { openStore } from './storage/openStore';
import { darkTheme, lightTheme, type Theme } from './theme';

type TabName = 'Drive' | 'Stats' | 'Settings';

const Tab = createBottomTabNavigator();

const TAB_ICONS: Record<TabName, keyof typeof MaterialCommunityIcons.glyphMap> = {
  Drive: 'leaf',
  Stats: 'chart-bar',
  Settings: 'cog-outline',
};

/**
 * Bridges our generated Material 3 palettes into react-navigation's own
 * Theme shape (colors *and* fonts) — computed once, not per render, since
 * neither palette ever changes at runtime.
 */
const { LightTheme: NAV_LIGHT_THEME, DarkTheme: NAV_DARK_THEME } = adaptNavigationTheme({
  reactNavigationLight: NavigationDefaultTheme,
  reactNavigationDark: NavigationDarkTheme,
  materialLight: lightTheme,
  materialDark: darkTheme,
});

/**
 * Screens render with headerShown: false, so nothing else pads the status bar
 * / camera-cutout area away from a screen's own content.
 */
function withTopInset(Screen: React.ComponentType, theme: Theme) {
  return function ScreenWithTopInset() {
    return (
      <SafeAreaView
        edges={['top']}
        style={[styles.safeArea, { backgroundColor: theme.colors.background }]}
      >
        <Screen />
      </SafeAreaView>
    );
  };
}

/**
 * A Material 3 bottom navigation bar (elevated surface, pill-shaped active
 * indicator, ripple) in place of react-navigation's own plain tab bar — the
 * documented react-native-paper + react-navigation integration pattern.
 * `tabBarIcon` still comes from each Tab.Screen's own options; this only
 * changes how the bar around it is drawn.
 */
function MaterialTabBar({ navigation, state, descriptors, insets }: BottomTabBarProps) {
  return (
    <BottomNavigation.Bar
      navigationState={state}
      safeAreaInsets={insets}
      onTabPress={({ route, preventDefault }) => {
        const event = navigation.emit({
          type: 'tabPress',
          target: route.key,
          canPreventDefault: true,
        });
        if (event.defaultPrevented) {
          preventDefault();
        } else {
          navigation.dispatch({
            ...CommonActions.navigate(route.name, route.params),
            target: state.key,
          });
        }
      }}
      renderIcon={({ route, focused, color }) => {
        const { options } = descriptors[route.key]!;
        return typeof options.tabBarIcon === 'function'
          ? options.tabBarIcon({ focused, color, size: 24 })
          : null;
      }}
      getLabelText={({ route }) => {
        const { options } = descriptors[route.key]!;
        if (typeof options.tabBarLabel === 'string') return options.tabBarLabel;
        return options.title ?? route.name;
      }}
      getTestID={({ route }) => `tab-${route.name}`}
    />
  );
}

function Tabs({ theme }: { theme: Theme }) {
  return (
    <Tab.Navigator
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <MaterialTabBar {...props} />}
    >
      {(Object.keys(TAB_ICONS) as TabName[]).map((name) => (
        <Tab.Screen
          key={name}
          name={name}
          component={withTopInset(
            { Drive: DriveScreen, Stats: StatsScreen, Settings: SettingsScreen }[name],
            theme,
          )}
          options={{
            tabBarIcon: ({ color, size }) => (
              <MaterialCommunityIcons name={TAB_ICONS[name]} color={color} size={size} />
            ),
          }}
        />
      ))}
    </Tab.Navigator>
  );
}

export default function App() {
  const scheme = useColorScheme();
  const theme = scheme === 'dark' ? darkTheme : lightTheme;
  const navTheme = scheme === 'dark' ? NAV_DARK_THEME : NAV_LIGHT_THEME;
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

  return (
    <PaperProvider
      theme={theme}
      settings={{ icon: (props) => <MaterialCommunityIcons {...props} /> }}
    >
      <StatusBar style={theme.dark ? 'light' : 'dark'} />
      {failure !== null ? (
        <ErrorScreen error={failure} theme={theme} />
      ) : store === null ? (
        <View style={[styles.centre, { backgroundColor: theme.colors.background }]}>
          <ActivityIndicator color={theme.colors.primary} />
        </View>
      ) : (
        <SafeAreaProvider>
          <DriveProvider store={store}>
            <NavigationContainer theme={navTheme}>
              <Tabs theme={theme} />
            </NavigationContainer>
          </DriveProvider>
        </SafeAreaProvider>
      )}
    </PaperProvider>
  );
}

function ErrorScreen({ error, theme }: { error: Error; theme: Theme }) {
  return (
    <View style={[styles.centre, { backgroundColor: theme.colors.background }]}>
      <Text variant="titleLarge" style={styles.errorTitle}>
        Could not open your data
      </Text>
      <Text variant="bodyMedium" style={styles.errorBody}>
        {error.message}
      </Text>
      <Text
        variant="bodyMedium"
        style={[styles.errorBody, { color: theme.colors.onSurfaceVariant }]}
      >
        Your driving history is still on this device. Restarting the app is usually enough.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  errorTitle: { marginBottom: 12, textAlign: 'center' },
  errorBody: { textAlign: 'center', marginBottom: 8 },
});
