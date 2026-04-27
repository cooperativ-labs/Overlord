import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { Link, Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
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
  getServerDeviceCredential,
  saveServerDeviceCredential
} from '@/lib/server-device-credentials';
import { getSupabase } from '@/lib/supabase';
import type { DeviceServerCredential, ServerStatus } from '@/lib/types';
import { deleteKey, generateKey, installPublicKey, verifyConnection } from '@/modules/ssh';

type IoniconName = keyof typeof Ionicons.glyphMap;

const statusConfig: Record<ServerStatus, { label: string; color: string; icon: IoniconName }> = {
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

  const [copied, setCopied] = useState(false);
  const [generatingKey, setGeneratingKey] = useState(false);

  async function handleCopyPublicKey() {
    if (!credential?.publicKey) return;
    await Clipboard.setStringAsync(credential.publicKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleGenerateAndCopyKey() {
    if (!server) return;
    setGeneratingKey(true);
    try {
      const tag = `com.cooperativ.overlord.ssh.${Date.now()}`;
      const keyResult = await generateKey(tag);

      await saveServerDeviceCredential({
        serverId,
        keyTag: tag,
        publicKey: keyResult.publicKeyOpenSSH,
        publicKeyFingerprint: keyResult.fingerprint,
        isHardwareBacked: keyResult.isHardwareBacked,
        createdAt: new Date().toISOString()
      });

      await loadCredential();
      await Clipboard.setStringAsync(keyResult.publicKeyOpenSSH);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      Alert.alert(
        'Key Generation Failed',
        error instanceof Error ? error.message : 'Failed to generate the device SSH key.'
      );
    } finally {
      setGeneratingKey(false);
    }
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

  // Whether this SSH server needs key installation (no credential, or never verified)
  const needsKeyInstall =
    server?.transport === 'ssh' && (!credential?.keyTag || server.status !== 'connected');

  async function handleInstallKeyAndVerify() {
    if (!server) return;

    if (!password.trim()) {
      Alert.alert(
        'Password Required',
        "Enter the server password so Overlord can install this device's SSH key. The password is used once and never stored."
      );
      return;
    }

    setVerifying(true);

    try {
      // Generate a device key if we don't have one for this server
      let currentKeyTag = credential?.keyTag;
      let currentPublicKey = credential?.publicKey;
      let currentFingerprint = credential?.publicKeyFingerprint;
      let isHardwareBacked = credential?.isHardwareBacked ?? false;

      if (!currentKeyTag) {
        const tag = `com.cooperativ.overlord.ssh.${Date.now()}`;
        const keyResult = await generateKey(tag);
        currentKeyTag = tag;
        currentPublicKey = keyResult.publicKeyOpenSSH;
        currentFingerprint = keyResult.fingerprint;
        isHardwareBacked = keyResult.isHardwareBacked;
      }

      // Install the public key on the server using password auth
      const installResult = await installPublicKey(
        server.host,
        server.port,
        server.username,
        password,
        currentPublicKey!
      );

      // Verify the key works via pubkey auth
      const verifyResult = await verifyConnection({
        host: server.host,
        port: server.port,
        username: server.username,
        transport: 'ssh',
        keyTag: currentKeyTag,
        expectedHostKeyFingerprint: installResult.hostKeyFingerprint
      });

      // Save/update the device credential
      await saveServerDeviceCredential({
        serverId,
        keyTag: currentKeyTag,
        publicKey: currentPublicKey!,
        publicKeyFingerprint: currentFingerprint!,
        isHardwareBacked,
        createdAt: credential?.createdAt ?? new Date().toISOString()
      });

      const verificationTime = new Date().toISOString();
      await updateServerVerification('connected', {
        hostKeyFingerprint: verifyResult.hostKeyFingerprint,
        lastError: null,
        lastConnectedAt: verificationTime,
        lastVerifiedAt: verificationTime
      });

      // Reload credential so the UI updates
      await loadCredential();
      setPassword('');
      await refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to install the SSH key.';

      try {
        await updateServerVerification('error', { lastError: message });
      } catch {
        // Ignore update failures
      }

      Alert.alert('Key Installation Failed', message);
      await refresh();
    } finally {
      setVerifying(false);
    }
  }

  async function handleVerify() {
    if (!server) return;

    // For SSH servers that need key installation, use the install flow
    if (needsKeyInstall) {
      return handleInstallKeyAndVerify();
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
      const message =
        error instanceof Error ? error.message : 'Failed to verify the server connection.';

      // If key auth failed, suggest reinstalling the key
      if (
        server.transport === 'ssh' &&
        (message.includes('authentication') ||
          message.includes('public key') ||
          message.includes('signature'))
      ) {
        try {
          await updateServerVerification('error', { lastError: message });
        } catch {
          // Ignore
        }
        await refresh();
        Alert.alert(
          'Key Auth Failed',
          'The SSH key on this device may not be installed on the server. Enter your server password below and tap "Install Key & Connect" to reinstall it.'
        );
        return;
      }

      try {
        await updateServerVerification('error', { lastError: message });
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
        <Ionicons name={status.icon} size={20} color={status.color} />
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
                onPress={handleCopyPublicKey}
              >
                <Ionicons
                  name={copied ? 'checkmark-circle' : 'copy-outline'}
                  size={16}
                  color={copied ? colors.success : colors.primary}
                />
                <Text style={[styles.copyKeyText, copied && { color: colors.success }]}>
                  {copied ? 'Copied!' : 'Copy Public Key'}
                </Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.noKeyText}>
                This device does not have a local SSH key for this server.
              </Text>
              <Text style={styles.noKeyHint}>
                If password login is disabled on your server, generate a key here and copy it to
                install manually.
              </Text>
              <Pressable
                style={({ pressed }) => [
                  styles.generateKeyButton,
                  generatingKey && styles.disabledButton,
                  pressed && !generatingKey && { opacity: 0.7 }
                ]}
                onPress={handleGenerateAndCopyKey}
                disabled={generatingKey}
              >
                {generatingKey ? (
                  <>
                    <ActivityIndicator size="small" color={colors.primaryForeground} />
                    <Text style={styles.generateKeyButtonText}>Generating...</Text>
                  </>
                ) : (
                  <>
                    <Ionicons name="key-outline" size={16} color={colors.primaryForeground} />
                    <Text style={styles.generateKeyButtonText}>Generate Key & Copy</Text>
                  </>
                )}
              </Pressable>
            </>
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
        <Text style={styles.sectionTitle}>{needsKeyInstall ? 'Connect' : 'Verify'}</Text>
        <View style={styles.card}>
          <Text style={styles.helperText}>
            {needsKeyInstall
              ? "Enter your server password to install this device's SSH key and verify the connection. The password is used once and never stored."
              : 'Verification connects to the server, checks the pinned host key, and runs `ovld --version`.'}
          </Text>
          {needsKeyInstall || server.transport === 'tailscale_ssh' ? (
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder={
                server.transport === 'tailscale_ssh'
                  ? 'Password or placeholder value'
                  : 'Enter server password'
              }
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
                <Text style={styles.primaryButtonText}>
                  {needsKeyInstall ? 'Installing & Verifying...' : 'Verifying...'}
                </Text>
              </>
            ) : (
              <>
                <Ionicons
                  name={needsKeyInstall ? 'key-outline' : 'checkmark-circle-outline'}
                  size={18}
                  color={colors.primaryForeground}
                />
                <Text style={styles.primaryButtonText}>
                  {needsKeyInstall ? 'Install Key & Connect' : 'Verify Connection'}
                </Text>
              </>
            )}
          </Pressable>
        </View>
      </View>

      {server.status === 'connected' ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Workspace</Text>
          <Link href={`/(tabs)/account/servers/${serverId}/workspace`} asChild>
            <Pressable
              style={({ pressed }) => [styles.workspaceButton, pressed && { opacity: 0.7 }]}
            >
              <Ionicons name="folder-open-outline" size={18} color={colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.workspaceButtonTitle}>Open Remote Workspace</Text>
                <Text style={styles.workspaceButtonHint}>
                  View git status + files on this server through the Overlord remote helper.
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />
            </Pressable>
          </Link>
        </View>
      ) : null}

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
  noKeyHint: {
    color: colors.mutedForeground,
    fontSize: 13,
    lineHeight: 18
  },
  generateKeyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 16
  },
  generateKeyButtonText: {
    color: colors.primaryForeground,
    fontSize: 14,
    fontWeight: '600'
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
  },
  workspaceButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14
  },
  workspaceButtonTitle: {
    color: colors.foreground,
    fontSize: 15,
    fontWeight: '600'
  },
  workspaceButtonHint: {
    color: colors.mutedForeground,
    fontSize: 12,
    marginTop: 2,
    lineHeight: 16
  }
});
