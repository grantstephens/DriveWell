import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useDrive } from '../DriveContext';
import { confirm, notify } from '../platform/confirm';
import { useTheme } from '../ThemeContext';
import type { Theme } from '../theme';

/**
 * Settings holds everything that is neither driving nor a stat: the plain-
 * language explanation of how scoring works, and the destructive action.
 */
export function SettingsScreen() {
  const { store, bump } = useDrive();
  const theme = useTheme();
  const styles = createStyles(theme);

  async function handleDelete(): Promise<void> {
    const ok = await confirm(
      'Delete driving history',
      'This permanently removes every recorded drive, including your best score. This cannot be undone.',
    );
    if (!ok) return;
    await store.deleteAllTrips();
    bump();
    await notify('Deleted', 'Your driving history has been cleared.');
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.section}>
        <Text style={styles.heading}>How scoring works</Text>
        <Text style={styles.body}>
          DriveWell watches your phone's accelerometer while you drive. Sudden braking,
          hard acceleration, and sharp cornering turn the leaf brown; a steady, gentle
          touch turns it green. Once the leaf is fully green, you start earning points —
          smooth driving is efficient driving.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>Your data</Text>
        <Text style={styles.body}>
          Every trip is stored only on this device. DriveWell makes no network requests
          and shares nothing.
        </Text>
      </View>

      <Pressable
        testID="settings-delete"
        onPress={() => void handleDelete()}
        style={styles.deleteButton}
      >
        <Text style={styles.deleteLabel}>Delete driving history</Text>
      </Pressable>
    </ScrollView>
  );
}

function createStyles(theme: Theme) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.background },
    content: { padding: 24, gap: 24 },
    section: { gap: 8 },
    heading: { fontSize: 16, fontWeight: '700', color: theme.text },
    body: { fontSize: 14, color: theme.textMuted, lineHeight: 20 },
    deleteButton: {
      borderWidth: 1,
      borderColor: '#B3261E',
      borderRadius: 12,
      paddingVertical: 14,
      alignItems: 'center',
      marginTop: 8,
    },
    deleteLabel: { color: '#B3261E', fontSize: 15, fontWeight: '700' },
  });
}
