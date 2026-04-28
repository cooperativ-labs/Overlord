import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';

import { useThemeColors, useThemedStyles, type ThemeColors } from '@/lib/colors';
import { useServerConnections } from '@/lib/server-connections-context';
import type { GitStatusFile, GitStatusResult, MobileHelperConfig } from '@/lib/workspace';
import {
  deleteHelperConfig,
  getHelperConfig,
  MobileRemoteWorkspaceClient,
  saveHelperConfig
} from '@/lib/workspace';

function getStatusStyle(colors: ThemeColors): Record<string, { label: string; color: string }> {
  return {
    modified: { label: 'M', color: colors.primary },
    added: { label: 'A', color: colors.success },
    deleted: { label: 'D', color: colors.destructive },
    renamed: { label: 'R', color: '#f59e0b' },
    untracked: { label: '?', color: colors.mutedForeground },
    copied: { label: 'C', color: '#8b5cf6' }
  };
}

type HealthState =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'ok'; version?: string }
  | { phase: 'error'; error: string };

export default function WorkspaceScreen() {
  const { serverId } = useLocalSearchParams<{ serverId: string }>();
  const { getServerById } = useServerConnections();
  const colors = useThemeColors();
  const styles = useThemedStyles(createStyles);
  const statusStyle = getStatusStyle(colors);
  const server = getServerById(serverId);

  const [config, setConfig] = useState<MobileHelperConfig | null>(null);
  const [loadingConfig, setLoadingConfig] = useState(true);

  const [baseUrl, setBaseUrl] = useState('');
  const [authToken, setAuthToken] = useState('');
  const [remoteDirectory, setRemoteDirectory] = useState('');
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);

  const [health, setHealth] = useState<HealthState>({ phase: 'idle' });
  const [status, setStatus] = useState<GitStatusResult | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const loadConfig = useCallback(async () => {
    setLoadingConfig(true);
    try {
      const stored = await getHelperConfig(serverId);
      setConfig(stored);
      if (stored) {
        setBaseUrl(stored.baseUrl);
        setAuthToken(stored.authToken);
        setRemoteDirectory(stored.remoteWorkingDirectory);
        setEditing(false);
      } else {
        setEditing(true);
      }
    } catch (error) {
      Alert.alert(
        'Could not load workspace config',
        error instanceof Error ? error.message : 'Secure storage unavailable.'
      );
      setEditing(true);
    } finally {
      setLoadingConfig(false);
    }
  }, [serverId]);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  const client = useMemo(() => {
    if (!config) return null;
    try {
      return new MobileRemoteWorkspaceClient({
        baseUrl: config.baseUrl,
        authToken: config.authToken,
        remoteWorkingDirectory: config.remoteWorkingDirectory
      });
    } catch {
      return null;
    }
  }, [config]);

  const checkHelperHealth = useCallback(async () => {
    if (!client) return;
    setHealth({ phase: 'checking' });
    const result = await client.checkHealth();
    if (result.ok) {
      setHealth({ phase: 'ok', version: result.helperVersion });
    } else {
      setHealth({ phase: 'error', error: result.error ?? 'Helper unreachable.' });
    }
  }, [client]);

  const fetchStatus = useCallback(async () => {
    if (!client) return;
    setLoadingStatus(true);
    setStatusError(null);
    try {
      const result = await client.getGitStatus();
      if (result.error) {
        setStatusError(result.error);
        setStatus(null);
      } else {
        setStatus(result);
      }
    } catch (error) {
      setStatusError(error instanceof Error ? error.message : 'Failed to load git status.');
    } finally {
      setLoadingStatus(false);
    }
  }, [client]);

  useEffect(() => {
    if (client) {
      void checkHelperHealth();
      void fetchStatus();
    }
  }, [client, checkHelperHealth, fetchStatus]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    Promise.allSettled([checkHelperHealth(), fetchStatus()]).finally(() => setRefreshing(false));
  }, [checkHelperHealth, fetchStatus]);

  async function handleSaveConfig() {
    const trimmedBase = baseUrl.trim();
    const trimmedToken = authToken.trim();
    const trimmedDir = remoteDirectory.trim();

    if (!trimmedBase || !trimmedToken || !trimmedDir) {
      Alert.alert(
        'Missing fields',
        'Helper URL, auth token, and remote directory are all required.'
      );
      return;
    }
    if (!/^https?:\/\//i.test(trimmedBase)) {
      Alert.alert('Invalid URL', 'Helper URL must start with http:// or https://');
      return;
    }

    setSaving(true);
    try {
      const next: MobileHelperConfig = {
        serverId,
        baseUrl: trimmedBase,
        authToken: trimmedToken,
        remoteWorkingDirectory: trimmedDir
      };
      await saveHelperConfig(next);
      setConfig(next);
      setEditing(false);
    } catch (error) {
      Alert.alert(
        'Save failed',
        error instanceof Error ? error.message : 'Could not store workspace config.'
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteConfig() {
    Alert.alert(
      'Remove workspace config?',
      'The helper URL and token will be deleted from this device.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            await deleteHelperConfig(serverId);
            setConfig(null);
            setBaseUrl('');
            setAuthToken('');
            setRemoteDirectory('');
            setStatus(null);
            setHealth({ phase: 'idle' });
            setEditing(true);
          }
        }
      ]
    );
  }

  if (!server) {
    return (
      <View style={styles.centered}>
        <Text style={styles.mutedText}>Server not found.</Text>
      </View>
    );
  }

  if (loadingConfig) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const showingEditor = editing || !config;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
      }
    >
      <Stack.Screen options={{ title: `${server.label} Workspace` }} />

      {showingEditor ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Helper Configuration</Text>
          <View style={styles.card}>
            <Text style={styles.helperText}>
              Enter the remote helper&apos;s base URL (e.g. a Tailscale-reachable{' '}
              http://host.tailnet.ts.net:port), the bearer token from ~/.overlord/remote/token on
              the server, and the project directory.
            </Text>
            <TextInput
              style={styles.input}
              value={baseUrl}
              onChangeText={setBaseUrl}
              placeholder="http://host.tailnet.ts.net:8123"
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
            <TextInput
              style={styles.input}
              value={authToken}
              onChangeText={setAuthToken}
              placeholder="Helper auth token"
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
            />
            <TextInput
              style={styles.input}
              value={remoteDirectory}
              onChangeText={setRemoteDirectory}
              placeholder="/home/you/code/project"
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Pressable
              style={({ pressed }) => [
                styles.primaryButton,
                saving && styles.disabledButton,
                pressed && !saving && { opacity: 0.7 }
              ]}
              onPress={handleSaveConfig}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator color={colors.primaryForeground} />
              ) : (
                <>
                  <Ionicons name="save-outline" size={18} color={colors.primaryForeground} />
                  <Text style={styles.primaryButtonText}>Save &amp; Connect</Text>
                </>
              )}
            </Pressable>
            {config ? (
              <Pressable
                style={({ pressed }) => [styles.linkButton, pressed && { opacity: 0.6 }]}
                onPress={() => setEditing(false)}
              >
                <Text style={styles.linkText}>Cancel</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : (
        <>
          <View style={styles.section}>
            <View style={styles.sectionRow}>
              <Text style={styles.sectionTitle}>Helper</Text>
              <Pressable onPress={() => setEditing(true)}>
                <Text style={styles.linkText}>Edit</Text>
              </Pressable>
            </View>
            <View style={styles.card}>
              <DetailRow label="URL" value={config!.baseUrl} mono />
              <DetailRow label="Directory" value={config!.remoteWorkingDirectory} mono />
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Health</Text>
                <HealthBadge state={health} />
              </View>
              <Pressable
                style={({ pressed }) => [styles.secondaryButton, pressed && { opacity: 0.7 }]}
                onPress={() => void checkHelperHealth()}
              >
                <Ionicons name="pulse-outline" size={16} color={colors.primary} />
                <Text style={styles.secondaryButtonText}>Recheck health</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.deleteButton, pressed && { opacity: 0.7 }]}
                onPress={handleDeleteConfig}
              >
                <Ionicons name="trash-outline" size={16} color={colors.destructive} />
                <Text style={styles.deleteText}>Remove workspace config</Text>
              </Pressable>
            </View>
          </View>

          <View style={styles.section}>
            <View style={styles.sectionRow}>
              <Text style={styles.sectionTitle}>
                Current changes{status?.branch ? ` · ${status.branch}` : ''}
              </Text>
              <Pressable onPress={() => void fetchStatus()} disabled={loadingStatus}>
                <Ionicons
                  name="refresh-outline"
                  size={18}
                  color={loadingStatus ? colors.mutedForeground : colors.primary}
                />
              </Pressable>
            </View>
            <View style={styles.card}>
              {loadingStatus ? (
                <ActivityIndicator color={colors.primary} />
              ) : statusError ? (
                <Text style={styles.errorBody}>{statusError}</Text>
              ) : !status || status.files.length === 0 ? (
                <Text style={styles.mutedText}>Working tree is clean.</Text>
              ) : (
                <FlatList
                  data={status.files}
                  keyExtractor={file => `${file.path}:${file.status}`}
                  scrollEnabled={false}
                  renderItem={({ item }) => <StatusRow file={item} />}
                  ItemSeparatorComponent={() => <View style={styles.divider} />}
                />
              )}
            </View>
          </View>
        </>
      )}
    </ScrollView>
  );
}

function HealthBadge({ state }: { state: HealthState }) {
  const colors = useThemeColors();
  const styles = useThemedStyles(createStyles);

  if (state.phase === 'checking') {
    return <ActivityIndicator color={colors.primary} />;
  }
  if (state.phase === 'ok') {
    return (
      <View style={styles.healthBadge}>
        <View style={[styles.statusDot, { backgroundColor: colors.success }]} />
        <Text style={[styles.detailValue, { color: colors.success }]}>
          Ready{state.version ? ` · v${state.version}` : ''}
        </Text>
      </View>
    );
  }
  if (state.phase === 'error') {
    return (
      <View style={styles.healthBadge}>
        <View style={[styles.statusDot, { backgroundColor: colors.destructive }]} />
        <Text
          style={[styles.detailValue, { color: colors.destructive, maxWidth: 200 }]}
          numberOfLines={2}
        >
          {state.error}
        </Text>
      </View>
    );
  }
  return <Text style={styles.detailValue}>—</Text>;
}

function StatusRow({ file }: { file: GitStatusFile }) {
  const colors = useThemeColors();
  const styles = useThemedStyles(createStyles);
  const statusStyle = getStatusStyle(colors);
  const style = statusStyle[file.status] ?? {
    label: file.stagedStatus || file.unstagedStatus || '·',
    color: colors.mutedForeground
  };
  return (
    <View style={styles.statusRow}>
      <View style={[styles.statusChip, { borderColor: style.color }]}>
        <Text style={[styles.statusChipText, { color: style.color }]}>{style.label}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.statusPath} numberOfLines={2}>
          {file.path}
        </Text>
        {file.linesAdded !== null || file.linesRemoved !== null ? (
          <Text style={styles.statusMeta}>
            {file.linesAdded ? `+${file.linesAdded}` : ''}
            {file.linesAdded !== null && file.linesRemoved ? ' ' : ''}
            {file.linesRemoved ? `-${file.linesRemoved}` : ''}
          </Text>
        ) : null}
      </View>
    </View>
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
  const styles = useThemedStyles(createStyles);

  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text
        style={[styles.detailValue, mono && styles.monoText, { flexShrink: 1, textAlign: 'right' }]}
        numberOfLines={2}
        selectable
      >
        {value}
      </Text>
    </View>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16 },
  centered: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center'
  },
  section: { marginBottom: 24 },
  sectionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10
  },
  sectionTitle: {
    color: colors.mutedForeground,
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 12
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
    paddingVertical: 12,
    color: colors.foreground,
    fontSize: 15
  },
  primaryButton: {
    marginTop: 4,
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8
  },
  primaryButtonText: { color: colors.primaryForeground, fontSize: 15, fontWeight: '600' },
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10
  },
  secondaryButtonText: { color: colors.primary, fontSize: 14, fontWeight: '500' },
  linkButton: { alignItems: 'center', paddingVertical: 6 },
  linkText: { color: colors.primary, fontSize: 14, fontWeight: '500' },
  deleteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10
  },
  deleteText: { color: colors.destructive, fontSize: 14, fontWeight: '500' },
  disabledButton: { opacity: 0.5 },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12
  },
  detailLabel: { color: colors.mutedForeground, fontSize: 14 },
  detailValue: { color: colors.foreground, fontSize: 14, fontWeight: '500' },
  monoText: { fontFamily: 'Menlo', fontSize: 12 },
  mutedText: { color: colors.mutedForeground, fontSize: 14 },
  errorBody: { color: colors.destructive, fontSize: 13, lineHeight: 18 },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 10 },
  statusRow: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  statusChip: {
    width: 28,
    height: 28,
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center'
  },
  statusChipText: { fontSize: 12, fontWeight: '700' },
  statusPath: { color: colors.foreground, fontSize: 13, fontFamily: 'Menlo' },
  statusMeta: { color: colors.mutedForeground, fontSize: 11, marginTop: 2 },
  healthBadge: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusDot: { width: 8, height: 8, borderRadius: 4 }
  });
