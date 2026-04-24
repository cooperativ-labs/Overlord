import * as Sentry from '@sentry/react-native';
import { Button, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/lib/auth-context';
import { colors } from '@/lib/colors';

const ADMIN_EMAIL = 'jake@cooperativ.io';

export default function AdminScreen() {
  const { user } = useAuth();

  if (user?.email?.toLowerCase() !== ADMIN_EMAIL) {
    return (
      <View style={styles.container}>
        <Text style={styles.accessDenied}>Access denied</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Sentry</Text>
        <Button title="Try!" onPress={() => { Sentry.captureException(new Error('First error')); }} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background
  },
  content: {
    padding: 16,
    gap: 16
  },
  accessDenied: {
    color: colors.mutedForeground,
    fontSize: 16,
    textAlign: 'center',
    marginTop: 40
  },
  section: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 12
  },
  sectionTitle: {
    color: colors.foreground,
    fontSize: 16,
    fontWeight: '600'
  }
});
