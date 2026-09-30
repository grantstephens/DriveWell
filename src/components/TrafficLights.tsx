import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text, useTheme } from 'react-native-paper';

import type { Breakdown, Light } from '../domain/breakdown';

/**
 * Real traffic-light colours, not theme colours: like the leaf, these mean
 * something (green/amber/red) independent of the app's own Material palette.
 */
const LIGHT_COLOR: Record<Light, string> = {
  green: '#3d9a4a',
  amber: '#e2a622',
  red: '#c9403a',
  unknown: '#9aa0a6',
};

const LIGHT_WORD: Record<Light, string> = {
  green: 'green',
  amber: 'amber',
  red: 'red',
  unknown: 'not enough signal',
};

const ROWS: { key: keyof Breakdown; label: string }[] = [
  { key: 'braking', label: 'Braking' },
  { key: 'cornering', label: 'Cornering' },
  { key: 'acceleration', label: 'Acceleration' },
];

/** TrafficLights shows how a finished drive did at braking, cornering and acceleration. */
export function TrafficLights({ breakdown }: { breakdown: Breakdown }) {
  const theme = useTheme();
  return (
    <View style={styles.row} testID="traffic-lights">
      {ROWS.map(({ key, label }) => {
        const light = breakdown[key].light;
        return (
          <View key={key} style={styles.item}>
            <View
              testID={`light-${key}`}
              accessibilityLabel={`${label}: ${LIGHT_WORD[light]}`}
              style={[styles.circle, { backgroundColor: LIGHT_COLOR[light] }]}
            />
            <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant, marginTop: 6 }}>
              {label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'flex-start', width: '100%' },
  item: { alignItems: 'center', minWidth: 88 },
  circle: { width: 44, height: 44, borderRadius: 22 },
});
