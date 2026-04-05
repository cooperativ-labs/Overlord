import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';

import { colors } from '@/lib/colors';
import { useServerConnections } from '@/lib/server-connections-context';
import {
  deleteServerDeviceCredential,
  getServerDeviceCredential
} from '@/lib/server-device-credentials';
import { getSupabase } from '@/lib/supabase';
import type { DeviceServerCredential, ServerStatus } from '@/lib/types';
import { deleteKey, verifyConnection } from '@/modules/ssh';

const statusConfig: Record<ServerStatus, { label: string; color: string; icon: string }> = {
  pending: { label: 'Pending Verification', color: colors.mutedForeground, icon: 'time-outline' },
  connected: { label: 'Connected', color: colors.success, icon: 'checkmark-circle-outline' },
  error: { label: 'Verification Error', color: colors.destructive, icon: 'alert-circle-outline' }
};

export default function ServerDetailScreen() {
  const { serverId } = useLocalSearchParams<{ serverId: string }>();
  const router = useRouter();
  const { getServerById, loading: loadingServers, refresh } = useServerConnections();

  const [credential, setCredential] = useState<DeviceServerCredential | null>(null);
  const [loadingCredential, setLoadingCredential] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [password, setPassword] = useState('');
  const server = getServerById(serverId);

  const loadCredential = useCallback(async () => {
    try {
      const localCredential = await getServerDeviceCredential(serverId);
      setCredential(localCredential);
    } finally {
      setLoadingCredential(false);
    }
  }, [serverId]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
      void loadCredential();
    }, [loadCredential, refresh])
  );

  function handleShowPublicKey() {
    if (!credential?.publicKey) return;
    Alert.alert('Public Key', credential.publicKey, [{ text: 'OK' }]);
  }

  async function updateServerVerification(
    nextStatus: ServerStatus,
    details: {
      hostKeyFingerprint?: string | null;
      lastError?: string | null;
      lastConnectedAt?: string | null;
      lastVerifiedAt?: string | null;
    }
  ) {
    const supabase = getSupabase();
    const { error } = await supabase
      .from('servers')
      .update({
        status: nextStatus,
        host_key_fingerprint: details.hostKeyFingerprint ?? server?.host_key_fingerprint ?? null,
        last_error: details.lastError ?? null,
        last_connected_at: details.lastConnectedAt ?? server?.last_connected_at ?? null,
        last_verified_at: details.lastVerifiedAt ?? server?.last_verified_at ?? null
      })
      .eq('id', serverId);

    if (error) {
      throw new Error(error.message);
    }
  }

  async function handleVerify() {
    if (!server) return;

    if (server.transport === 'ssh' && !credential?.keyTag) {
      Alert.alert(
        'Device Key Required',
        'This device does not have the SSH key for this server. Re-add the server from this phone to install a local key.'
      );
      return;
    }

    if (server.transport === 'tailscale_ssh' && !password.trim()) {
      Alert.alert(
        'Password Required',
        'Enter a password or compatibility placeholder so Overlord can verify the Tailscale SSH connection.'
      );
      return;
    }

    setVerifying(true);

    try {
      const result = await verifyConnection({
        host: server.host,
        port: server.port,
        username: server.username,
        transport: server.transport,
        keyTag: credential?.keyTag,
        password: server.transport === 'tailscale_ssh' ? password : undefined,
        expectedHostKeyFingerprint: server.host_key_fingerprint
      });

      const verificationTime = new Date().toISOString();
      await updateServerVerification('connected', {
        hostKeyFingerprint: result.hostKeyFingerprint,
        lastError: null,
        lastConnectedAt: verificationTime,
        lastVerifiedAt: verificationTime
      });

      await refresh();
    } catch (error) {
      try {
        await updateServerVerification('error', {
          lastError:
            error instanceof Error ? error.message : 'Failed to verify the server connection.'
        });
      } catch (updateError) {
        Alert.alert(
          'Verification Failed',
          updateError instanceof Error
            ? updateError.message
            : 'Could not persist verification failure.'
        );
      }

      await refresh();
    } finally {
      setVerifying(false);
    }
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
            if (credential?.keyTag) {
              deleteKey(credential.keyTag);
            }
            await deleteServerDeviceCredential(serverId);

            const supabase = getSupabase();
            const { error } = await supabase.from('servers').delete().eq('id', serverId);
            if (error) {
              Alert.alert('Failed to delete', error.message);
              return;
            }
            await refresh();
            router.back();
          } finally {
            setDeleting(false);
          }
        }
      }
    ]);
  }

  if (loadingServers || loadingCredential) {
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

      <View style={[styles.statusBanner, { borderColor: status.color + '40' }]}>
        <Ionicons name={status.icon as any} size={20} color={status.color} />
        <Text style={[styles.statusLabel, { color: status.color }]}>{status.label}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Connection</Text>
        <View style={styles.card}>
          <DetailRow
            label="Transport"
            value={server.transport === 'ssh' ? 'SSH' : 'Tailscale SSH'}
          />
          <DetailRow label="Host" value={server.host} />
          <DetailRow label="Port" value={String(server.port)} />
          <DetailRow label="Username" value={server.username} />
          {server.host_key_fingerprint ? (
            <DetailRow label="Pinned Host Key" value={server.host_key_fingerprint} mono />
          ) : null}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Device Credential</Text>
        <View style={styles.card}>
          {server.transport === 'tailscale_ssh' ? (
            <Text style={styles.noKeyText}>
              Tailscale SSH mode does not use a device-local SSH key.
            </Text>
          ) : credential ? (
            <>
              <DetailRow label="Fingerprint" value={credential.publicKeyFingerprint} mono />
              <DetailRow
                label="Backing"
                value={credential.isHardwareBacked ? 'Secure Enclave' : 'Software Keychain'}
              />
              <Pressable
                style={({ pressed }) => [styles.copyKeyButton, pressed && { opacity: 0.7 }]}
                onPress={handleShowPublicKey}
              >
                <Ionicons name="copy-outline" size={16} color={colors.primary} />
                <Text style={styles.copyKeyText}>Show Public Key</Text>
              </Pressable>
            </>
          ) : (
            <Text style={styles.noKeyText}>
              This device does not have a local SSH key for the server.
            </Text>
          )}
        </View>
      </View>

      {server.last_error ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Last Error</Text>
          <View style={[styles.card, styles.errorCard]}>
            <Text style={styles.errorBody}>{server.last_error}</Text>
          </View>
        </View>
      ) : null}

      {server.last_verified_at || server.last_connected_at ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Verification</Text>
          <View style={styles.card}>
            {server.last_verified_at ? (
              <DetailRow
                label="Last Verified"
                value={new Date(server.last_verified_at).toLocaleString()}
              />
            ) : null}
            {server.last_connected_at ? (
              <DetailRow
                label="Last Connected"
                value={new Date(server.last_connected_at).toLocaleString()}
              />
            ) : null}
          </View>
        </View>
      ) : null}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Verify</Text>
        <View style={styles.card}>
          <Text style={styles.helperText}>
            Verification connects to the server, checks the pinned host key, and runs `ovld
            --version`.
          </Text>
          {server.transport === 'tailscale_ssh' ? (
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder="Password or placeholder value"
              placeholderTextColor={colors.mutedForeground}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
            />
          ) : null}
          <Pressable
            style={({ pressed }) => [
              styles.primaryButton,
              verifying && styles.disabledButton,
              pressed && !verifying && { opacity: 0.7 }
            ]}
            onPress={handleVerify}
            disabled={verifying}
          >
            {verifying ? (
              <>
                <ActivityIndicator size="small" color={colors.primaryForeground} />
                <Text style={styles.primaryButtonText}>Verifying...</Text>
              </>
            ) : (
              <>
                <Ionicons
                  name="checkmark-circle-outline"
                  size={18}
                  color={colors.primaryForeground}
                />
                <Text style={styles.primaryButtonText}>Verify Connection</Text>
              </>
            )}
          </Pressable>
        </View>
      </View>

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
  mono = false
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={[styles.detailValue, mono && styles.monoText]} numberOfLines={1} selectable>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background
  },
  content: {
    padding: 16
  },
  centered: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center'
  },
  errorText: {
    color: colors.mutedForeground,
    fontSize: 16
  },
  statusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    marginBottom: 24
  },
  statusLabel: {
    fontSize: 15,
    fontWeight: '600'
  },
  section: {
    marginBottom: 24
  },
  sectionTitle: {
    color: colors.mutedForeground,
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 12
  },
  errorCard: {
    borderColor: colors.destructive + '40'
  },
  errorBody: {
    color: colors.destructive,
    fontSize: 14,
    lineHeight: 20
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  detailLabel: {
    color: colors.mutedForeground,
    fontSize: 14
  },
  detailValue: {
    color: colors.foreground,
    fontSize: 14,
    fontWeight: '500',
    flexShrink: 1,
    textAlign: 'right'
  },
  monoText: {
    fontFamily: 'Menlo',
    fontSize: 12
  },
  copyKeyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingTop: 4
  },
  copyKeyText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '500'
  },
  noKeyText: {
    color: colors.mutedForeground,
    fontSize: 14,
    lineHeight: 20
  },
  helperText: {
    color: colors.mutedForeground,
    fontSize: 13,
    lineHeight: 18
  },
  input: {
    backgroundColor: colors.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 14,
    color: colors.foreground,
    fontSize: 16
  },
  primaryButton: {
    marginTop: 4,
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10
  },
  primaryButtonText: {
    color: colors.primaryForeground,
    fontSize: 16,
    fontWeight: '600'
  },
  disabledButton: {
    opacity: 0.5
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
    paddingVertical: 15
  },
  deleteText: {
    color: colors.destructive,
    fontSize: 15,
    fontWeight: '600'
  }
});
