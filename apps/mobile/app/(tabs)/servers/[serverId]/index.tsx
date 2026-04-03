import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { colors } from '@/lib/colors';
import { getSupabase } from '@/lib/supabase';
import type { Server, ServerStatus } from '@/lib/types';

const statusConfig: Record<ServerStatus, { label: string; color: string; icon: string }> = {
  pending: { label: 'Pending Setup', color: colors.mutedForeground, icon: 'time-outline' },
  key_installed: { label: 'Key Installed', color: colors.primary, icon: 'key-outline' },
  connected: { label: 'Connected', color: colors.success, icon: 'checkmark-circle-outline' },
  error: { label: 'Connection Error', color: colors.destructive, icon: 'alert-circle-outline' },
};

export default function ServerDetailScreen() {
  const { serverId } = useLocalSearchParams<{ serverId: string }>();
  const router = useRouter();
  const [server, setServer] = useState<Server | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);

  const loadServer = useCallback(async () => {
    try {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from('servers')
        .select('*')
        .eq('id', serverId)
        .single();

      if (error) {
        Alert.alert('Failed to load server', error.message);
        return;
      }

      setServer(data);
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  useEffect(() => {
    loadServer();
  }, [loadServer]);

  function handleCopyPublicKey() {
    if (!server?.ssh_public_key) return;
    Alert.alert(
      'Public Key',
      server.ssh_public_key,
      [{ text: 'OK' }]
    );
  }

  async function handleDelete() {
    Alert.alert('Delete Server', `Remove "${server?.label}" from your servers?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setDeleting(true);
          try {
            const supabase = getSupabase();
            const { error } = await supabase.from('servers').delete().eq('id', serverId);
            if (error) {
              Alert.alert('Failed to delete', error.message);
              return;
            }
            router.back();
          } finally {
            setDeleting(false);
          }
        },
      },
    ]);
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!server) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Server not found</Text>
      </View>
    );
  }

  const status = statusConfig[server.status] ?? statusConfig.pending;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: server.label }} />

      {/* Status Banner */}
      <View style={[styles.statusBanner, { borderColor: status.color + '40' }]}>
        <Ionicons name={status.icon as any} size={20} color={status.color} />
        <Text style={[styles.statusLabel, { color: status.color }]}>{status.label}</Text>
      </View>

      {/* Connection Details */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Connection</Text>
        <View style={styles.card}>
          <DetailRow label="Host" value={server.host} />
          <DetailRow label="Port" value={String(server.port)} />
          <DetailRow label="Username" value={server.username} />
        </View>
      </View>

      {/* SSH Key Info */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>SSH Key</Text>
        <View style={styles.card}>
          {server.ssh_key_fingerprint ? (
            <>
              <DetailRow label="Fingerprint" value={server.ssh_key_fingerprint} mono />
              <DetailRow
                label="Type"
                value="ECDSA P-256 (Secure Enclave)"
              />
              <Pressable
                style={({ pressed }) => [styles.copyKeyButton, pressed && { opacity: 0.7 }]}
                onPress={handleCopyPublicKey}
              >
                <Ionicons name="copy-outline" size={16} color={colors.primary} />
                <Text style={styles.copyKeyText}>Copy Public Key</Text>
              </Pressable>
            </>
          ) : (
            <Text style={styles.noKeyText}>No SSH key generated yet</Text>
          )}
        </View>
      </View>

      {/* Public Key Display */}
      {server.ssh_public_key && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Public Key</Text>
          <View style={styles.card}>
            <Text style={styles.publicKeyText} selectable>
              {server.ssh_public_key}
            </Text>
          </View>
        </View>
      )}

      {/* Last Connected */}
      {server.last_connected_at && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Last Connected</Text>
          <View style={styles.card}>
            <Text style={styles.detailValue}>
              {new Date(server.last_connected_at).toLocaleString()}
            </Text>
          </View>
        </View>
      )}

      {/* Delete */}
      <View style={styles.section}>
        <Pressable
          style={({ pressed }) => [styles.deleteButton, pressed && { opacity: 0.7 }]}
          onPress={handleDelete}
          disabled={deleting}
        >
          {deleting ? (
            <ActivityIndicator size="small" color={colors.destructive} />
          ) : (
            <>
              <Ionicons name="trash-outline" size={18} color={colors.destructive} />
              <Text style={styles.deleteText}>Delete Server</Text>
            </>
          )}
        </Pressable>
      </View>
    </ScrollView>
  );
}

function DetailRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text
        style={[styles.detailValue, mono && styles.monoText]}
        numberOfLines={1}
        selectable
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: 16,
  },
  centered: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    color: colors.mutedForeground,
    fontSize: 16,
  },
  statusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    marginBottom: 24,
  },
  statusLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    color: colors.mutedForeground,
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 12,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  detailLabel: {
    color: colors.mutedForeground,
    fontSize: 14,
  },
  detailValue: {
    color: colors.foreground,
    fontSize: 14,
    fontWeight: '500',
    flexShrink: 1,
    textAlign: 'right',
  },
  monoText: {
    fontFamily: 'Menlo',
    fontSize: 12,
  },
  copyKeyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingTop: 4,
  },
  copyKeyText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '500',
  },
  noKeyText: {
    color: colors.mutedForeground,
    fontSize: 14,
  },
  publicKeyText: {
    color: colors.foreground,
    fontSize: 11,
    fontFamily: 'Menlo',
    lineHeight: 16,
  },
  deleteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.destructive + '40',
    padding: 14,
  },
  deleteText: {
    color: colors.destructive,
    fontSize: 16,
    fontWeight: '600',
  },
});
