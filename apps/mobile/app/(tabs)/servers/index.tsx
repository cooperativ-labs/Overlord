import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { colors } from '@/lib/colors';

export default function ServersScreen() {
  return (
    <View style={styles.container}>
      <View style={styles.empty}>
        <Ionicons name="server-outline" size={48} color={colors.mutedForeground} />
        <Text style={styles.emptyText}>Servers</Text>
        <Text style={styles.emptySubtext}>
          Register servers, manage SSH keys, and launch remote jobs
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  empty: {
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  emptyText: {
    color: colors.foreground,
    fontSize: 18,
    fontWeight: '600',
    marginTop: 16,
  },
  emptySubtext: {
    color: colors.mutedForeground,
    fontSize: 14,
    textAlign: 'center',
    marginTop: 8,
  },
});
