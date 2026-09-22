import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Card, Text, useTheme } from 'react-native-paper';

import { useDrive } from '../DriveContext';
import { confirm, notify } from '../platform/confirm';
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
      <Card>
        <Card.Content style={styles.cardContent}>
          <Text variant="titleMedium">How scoring works</Text>
          <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
            DriveWell watches your phone's accelerometer while you drive. Sudden braking,
            hard acceleration, and sharp cornering turn the leaf brown; a steady, gentle
            touch turns it green. Once the leaf is fully green, you start earning points —
            smooth driving is efficient driving.
          </Text>
        </Card.Content>
      </Card>

      <Card>
        <Card.Content style={styles.cardContent}>
          <Text variant="titleMedium">Your data</Text>
          <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
            Every trip is stored only on this device. DriveWell makes no network requests
            and shares nothing.
          </Text>
        </Card.Content>
      </Card>

      <View style={styles.deleteWrapper}>
        <Button
          testID="settings-delete"
          mode="outlined"
          textColor={theme.colors.error}
          style={{ borderColor: theme.colors.error }}
          onPress={() => void handleDelete()}
        >
          Delete driving history
        </Button>
      </View>
    </ScrollView>
  );
}

function createStyles(theme: Theme) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.colors.background },
    content: { padding: 24, gap: 24 },
    cardContent: { gap: 8 },
    deleteWrapper: { marginTop: 8 },
  });
}
