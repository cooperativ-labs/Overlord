import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';

import { useAuth } from '@/lib/auth-context';
import { colors } from '@/lib/colors';
import { useServerConnections } from '@/lib/server-connections-context';
import { saveServerDeviceCredential } from '@/lib/server-device-credentials';
import { getSupabase } from '@/lib/supabase';
import type { ServerStatus, ServerTransport } from '@/lib/types';
import { generateKey, installPublicKey, verifyConnection } from '@/modules/ssh';

type Step = 'form' | 'generating' | 'configure' | 'saving';

interface SaveServerInput {
  status: ServerStatus;
  hostKeyFingerprint?: string | null;
  lastError?: string | null;
  lastConnectedAt?: string | null;
  lastVerifiedAt?: string | null;
}

function parseServerPort(rawPort: string): number {
  const trimmed = rawPort.trim();
  if (!trimmed) return 22;

  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : Number.NaN;
}

function isLikelyTailscaleHost(rawHost: string): boolean {
  const host = rawHost.trim().toLowerCase();
  if (!host) return false;
  if (host.endsWith('.ts.net')) return true;

  const ipv4Match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4Match) return false;

  const octets = ipv4Match.slice(1).map(value => Number.parseInt(value, 10));
  if (octets.some(value => Number.isNaN(value) || value < 0 || value > 255)) {
    return false;
  }

  const [first, second] = octets;
  return first === 100 && second >= 64 && second <= 127;
}

export default function AddServerScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { refresh } = useServerConnections();

  const [label, setLabel] = useState('');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('');
  const [username, setUsername] = useState('');
  const [transport, setTransport] = useState<ServerTransport>('ssh');

  const [step, setStep] = useState<Step>('form');
  const [publicKey, setPublicKey] = useState('');
  const [fingerprint, setFingerprint] = useState('');
  const [keyTag, setKeyTag] = useState('');
  const [isHardwareBacked, setIsHardwareBacked] = useState(false);
  const [password, setPassword] = useState('');
  const [working, setWorking] = useState(false);
  const [copied, setCopied] = useState(false);

  async function handleCopyPublicKey() {
    if (!publicKey) return;
    await Clipboard.setStringAsync(publicKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const resolvedPort = parseServerPort(port);
  const canSubmit =
    label.trim().length > 0 &&
    host.trim().length > 0 &&
    username.trim().length > 0 &&
    Number.isFinite(resolvedPort);

  async function handleContinue() {
    if (!canSubmit) return;

    if (transport === 'tailscale_ssh') {
      setStep('configure');
      return;
    }

    setStep('generating');

    try {
      const tag = `com.cooperativ.overlord.ssh.${Date.now()}`;
      const result = await generateKey(tag);

      setKeyTag(tag);
      setPublicKey(result.publicKeyOpenSSH);
      setFingerprint(result.fingerprint);
      setIsHardwareBacked(result.isHardwareBacked);
      setStep('configure');
    } catch (error) {
      setStep('form');
      Alert.alert(
        'Key Generation Failed',
        error instanceof Error ? error.message : 'Failed to generate the device SSH key.'
      );
    }
  }

  async function saveServer(record: SaveServerInput) {
    if (!user) {
      throw new Error('You must be signed in to add a server.');
    }

    setStep('saving');

    try {
      const supabase = getSupabase();

      const { data: orgMember, error: orgError } = await supabase
        .from('members')
        .select('organization_id')
        .eq('user_id', user.id)
        .limit(1)
        .single();

      if (orgError || !orgMember) {
        throw new Error('Could not determine your organization.');
      }

      const { data, error: insertError } = await supabase
        .from('servers')
        .insert({
          user_id: user.id,
          organization_id: orgMember.organization_id,
          label: label.trim(),
          host: host.trim(),
          port: resolvedPort,
          username: username.trim(),
          transport,
          host_key_fingerprint: record.hostKeyFingerprint ?? null,
          status: record.status,
          last_error: record.lastError ?? null,
          last_connected_at: record.lastConnectedAt ?? null,
          last_verified_at: record.lastVerifiedAt ?? null
        })
        .select('id')
        .single();

      if (insertError || !data) {
        throw new Error(insertError?.message ?? 'Failed to save the server profile.');
      }

      if (transport === 'ssh') {
        if (!keyTag || !publicKey || !fingerprint) {
          throw new Error('The device SSH key is missing. Generate a key and try again.');
        }

        await saveServerDeviceCredential({
          serverId: data.id,
          keyTag,
          publicKey,
          publicKeyFingerprint: fingerprint,
          isHardwareBacked,
          createdAt: new Date().toISOString()
        });
      }

      return data.id;
    } catch (error) {
      setStep('configure');
      throw error;
    }
  }

  async function handleInstallAndVerify() {
    if (!password.trim()) {
      Alert.alert(
        'Password Required',
        'Enter the server password once to install this device key. The password is never stored.'
      );
      return;
    }

    setWorking(true);

    try {
      const installResult = await installPublicKey(
        host.trim(),
        resolvedPort,
        username.trim(),
        password,
        publicKey
      );

      const verificationTime = new Date().toISOString();

      try {
        const verifyResult = await verifyConnection({
          host: host.trim(),
          port: resolvedPort,
          username: username.trim(),
          transport: 'ssh',
          keyTag,
          expectedHostKeyFingerprint: installResult.hostKeyFingerprint
        });

        await saveServer({
          status: 'connected',
          hostKeyFingerprint: verifyResult.hostKeyFingerprint,
          lastConnectedAt: verificationTime,
          lastVerifiedAt: verificationTime,
          lastError: null
        });
      } catch (verifyError) {
        try {
          await saveServer({
            status: 'error',
            hostKeyFingerprint: installResult.hostKeyFingerprint,
            lastError:
              verifyError instanceof Error
                ? verifyError.message
                : 'The server key installed, but Overlord CLI verification failed.'
          });
        } catch (saveError) {
          Alert.alert(
            'Verification Failed',
            saveError instanceof Error
              ? saveError.message
              : 'Failed to save the verification error.'
          );
          return;
        }
      }

      await refresh();
      router.back();
    } catch (error) {
      Alert.alert(
        'Key Installation Failed',
        (error instanceof Error ? error.message : 'Failed to install the SSH key.') +
          '\n\nYou can still save the server profile and install the key manually later.'
      );
    } finally {
      setWorking(false);
    }
  }

  async function handleVerifyTailscaleAndSave() {
    if (!password.trim()) {
      Alert.alert(
        'Password Required',
        "Enter your Tailscale SSH compatibility password, or any placeholder if the host only checks the '+password' username mode."
      );
      return;
    }

    setWorking(true);

    try {
      const verifyResult = await verifyConnection({
        host: host.trim(),
        port: resolvedPort,
        username: username.trim(),
        transport: 'tailscale_ssh',
        password
      });

      const verificationTime = new Date().toISOString();
      await saveServer({
        status: 'connected',
        hostKeyFingerprint: verifyResult.hostKeyFingerprint,
        lastConnectedAt: verificationTime,
        lastVerifiedAt: verificationTime,
        lastError: null
      });

      await refresh();
      router.back();
    } catch (error) {
      try {
        await saveServer({
          status: 'error',
          lastError:
            error instanceof Error
              ? error.message
              : 'Failed to verify the Tailscale SSH connection.'
        });
      } catch (saveError) {
        Alert.alert(
          'Verification Failed',
          saveError instanceof Error ? saveError.message : 'Failed to save the verification error.'
        );
        return;
      }
      await refresh();
      router.back();
    } finally {
      setWorking(false);
    }
  }

  async function handleSaveWithoutVerification() {
    setWorking(true);

    try {
      await saveServer({
        status: 'pending',
        lastError: null
      });
      await refresh();
      router.back();
    } catch (error) {
      Alert.alert(
        'Failed to Save',
        error instanceof Error ? error.message : 'An unexpected error occurred.'
      );
    } finally {
      setWorking(false);
    }
  }

  if (step === 'form' || step === 'generating') {
    return (
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={100}
      >
        <Stack.Screen
          options={{
            title: 'Add Server',
            headerShown: true,
            headerBackTitle: 'Cancel',
            headerStyle: { backgroundColor: colors.background },
            headerTintColor: colors.foreground
          }}
        />

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.infoBanner}>
            <Ionicons
              name={transport === 'ssh' ? 'key-outline' : 'git-network-outline'}
              size={18}
              color={colors.primary}
            />
            <Text style={styles.infoBannerText}>
              {transport === 'ssh'
                ? 'SSH mode generates a device-specific P-256 key. When supported, the private key stays in the Secure Enclave.'
                : 'Tailscale SSH mode skips device-key installation and verifies the server directly over the tailnet.'}
            </Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.label}>Connection Mode</Text>
            <View style={styles.segmentedControl}>
              <TransportButton
                active={transport === 'ssh'}
                icon="key-outline"
                label="SSH"
                onPress={() => setTransport('ssh')}
              />
              <TransportButton
                active={transport === 'tailscale_ssh'}
                icon="git-network-outline"
                label="Tailscale SSH"
                onPress={() => setTransport('tailscale_ssh')}
              />
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.label}>Label</Text>
            <TextInput
              style={styles.input}
              value={label}
              onChangeText={setLabel}
              placeholder="My Production Server"
              placeholderTextColor={colors.mutedForeground}
              autoFocus
              returnKeyType="next"
            />
          </View>

          <View style={styles.section}>
            <Text style={styles.label}>Host</Text>
            <TextInput
              style={styles.input}
              value={host}
              onChangeText={setHost}
              placeholder="192.168.1.100 or server.example.com"
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              returnKeyType="next"
            />
            {isLikelyTailscaleHost(host) && transport === 'ssh' ? (
              <Text style={styles.helperText}>
                This looks like a Tailscale host. Use SSH mode only if you want a normal SSH daemon
                on the tailnet. Otherwise switch to Tailscale SSH mode.
              </Text>
            ) : null}
          </View>

          <View style={styles.section}>
            <Text style={styles.label}>Port</Text>
            <Text style={styles.helperText}>
              Leave blank for port 22. Tailscale SSH compatibility also uses port 22.
            </Text>
            <TextInput
              style={styles.input}
              value={port}
              onChangeText={setPort}
              placeholder="22 (default)"
              placeholderTextColor={colors.mutedForeground}
              keyboardType="number-pad"
              returnKeyType="next"
            />
          </View>

          <View style={styles.section}>
            <Text style={styles.label}>Username</Text>
            <TextInput
              style={styles.input}
              value={username}
              onChangeText={setUsername}
              placeholder="root"
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="done"
            />
          </View>

          <Pressable
            style={({ pressed }) => [
              styles.primaryButton,
              (!canSubmit || step === 'generating') && styles.disabledButton,
              pressed && canSubmit && { opacity: 0.7 }
            ]}
            onPress={handleContinue}
            disabled={!canSubmit || step === 'generating'}
          >
            {step === 'generating' ? (
              <>
                <ActivityIndicator size="small" color={colors.primaryForeground} />
                <Text style={styles.primaryButtonText}>Generating Device Key...</Text>
              </>
            ) : (
              <>
                <Ionicons
                  name={transport === 'ssh' ? 'key-outline' : 'arrow-forward'}
                  size={20}
                  color={colors.primaryForeground}
                />
                <Text style={styles.primaryButtonText}>
                  {transport === 'ssh' ? 'Generate Device Key & Continue' : 'Continue'}
                </Text>
              </>
            )}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  if (step === 'configure') {
    return (
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={100}
      >
        <Stack.Screen
          options={{
            title: transport === 'ssh' ? 'Install & Verify' : 'Verify Connection',
            headerShown: true,
            headerStyle: { backgroundColor: colors.background },
            headerTintColor: colors.foreground
          }}
        />

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {transport === 'ssh' ? (
            <>
              <View style={styles.successBanner}>
                <Ionicons name="checkmark-circle" size={20} color={colors.success} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.successBannerText}>
                    Device SSH key generated successfully
                  </Text>
                  {!isHardwareBacked ? (
                    <Text
                      style={[
                        styles.successBannerText,
                        { fontWeight: '400', fontSize: 12, marginTop: 2 }
                      ]}
                    >
                      Software-backed key (Secure Enclave not available on this device)
                    </Text>
                  ) : null}
                </View>
              </View>

              <View style={styles.section}>
                <Text style={styles.label}>Key Fingerprint</Text>
                <View style={styles.fingerprintBox}>
                  <Text style={styles.fingerprintText} selectable>
                    {fingerprint}
                  </Text>
                </View>
              </View>

              <View style={styles.section}>
                <Text style={styles.label}>Public Key</Text>
                <View style={styles.publicKeyBox}>
                  <Text style={styles.publicKeyText} numberOfLines={3} selectable>
                    {publicKey}
                  </Text>
                </View>
                <Pressable
                  style={({ pressed }) => [styles.copyKeyButton, pressed && { opacity: 0.7 }]}
                  onPress={handleCopyPublicKey}
                >
                  <Ionicons
                    name={copied ? 'checkmark-circle' : 'copy-outline'}
                    size={16}
                    color={copied ? colors.success : colors.primary}
                  />
                  <Text style={[styles.copyKeyLabel, copied && { color: colors.success }]}>
                    {copied ? 'Copied!' : 'Copy Public Key'}
                  </Text>
                </Pressable>
              </View>

              <View style={styles.section}>
                <Text style={styles.label}>Server Password</Text>
                <Text style={styles.helperText}>
                  Enter your password once so Overlord can add this device key to{' '}
                  ~/.ssh/authorized_keys{` `}and then verify that `ovld` is installed.
                </Text>
                <TextInput
                  style={styles.input}
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Enter server password"
                  placeholderTextColor={colors.mutedForeground}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>

              <Pressable
                style={({ pressed }) => [
                  styles.primaryButton,
                  working && styles.disabledButton,
                  pressed && !working && { opacity: 0.7 }
                ]}
                onPress={handleInstallAndVerify}
                disabled={working}
              >
                {working ? (
                  <>
                    <ActivityIndicator size="small" color={colors.primaryForeground} />
                    <Text style={styles.primaryButtonText}>Installing & Verifying...</Text>
                  </>
                ) : (
                  <>
                    <Ionicons
                      name="cloud-upload-outline"
                      size={20}
                      color={colors.primaryForeground}
                    />
                    <Text style={styles.primaryButtonText}>Install Key & Verify Overlord CLI</Text>
                  </>
                )}
              </Pressable>

              <Pressable
                style={({ pressed }) => [styles.secondaryButton, pressed && { opacity: 0.7 }]}
                onPress={handleSaveWithoutVerification}
                disabled={working}
              >
                <Text style={styles.secondaryButtonText}>Save Without Installing Yet</Text>
              </Pressable>

              <Text style={styles.manualHint}>
                You can still add the public key manually on the server and verify the connection
                later.
              </Text>
            </>
          ) : (
            <>
              <View style={styles.infoBanner}>
                <Ionicons name="git-network-outline" size={18} color={colors.primary} />
                <Text style={styles.infoBannerText}>
                  Tailscale SSH mode does not install a device key. Overlord will verify the host,
                  pin the server host key, and check that the remote machine has `ovld` installed.
                </Text>
              </View>

              <View style={styles.section}>
                <Text style={styles.label}>Password / Compatibility Value</Text>
                <Text style={styles.helperText}>
                  Use the password required by the server, or any placeholder value if your
                  Tailscale SSH policy only checks the `username+password` compatibility mode.
                </Text>
                <TextInput
                  style={styles.input}
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Enter password or placeholder"
                  placeholderTextColor={colors.mutedForeground}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>

              <Pressable
                style={({ pressed }) => [
                  styles.primaryButton,
                  working && styles.disabledButton,
                  pressed && !working && { opacity: 0.7 }
                ]}
                onPress={handleVerifyTailscaleAndSave}
                disabled={working}
              >
                {working ? (
                  <>
                    <ActivityIndicator size="small" color={colors.primaryForeground} />
                    <Text style={styles.primaryButtonText}>Verifying...</Text>
                  </>
                ) : (
                  <>
                    <Ionicons
                      name="checkmark-circle-outline"
                      size={20}
                      color={colors.primaryForeground}
                    />
                    <Text style={styles.primaryButtonText}>Verify & Save</Text>
                  </>
                )}
              </Pressable>

              <Pressable
                style={({ pressed }) => [styles.secondaryButton, pressed && { opacity: 0.7 }]}
                onPress={handleSaveWithoutVerification}
                disabled={working}
              >
                <Text style={styles.secondaryButtonText}>Save Without Verifying</Text>
              </Pressable>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  return (
    <View style={styles.centered}>
      <Stack.Screen
        options={{
          title: 'Saving...',
          headerShown: true,
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.foreground
        }}
      />
      <ActivityIndicator size="large" color={colors.primary} />
      <Text style={styles.savingText}>Saving server...</Text>
    </View>
  );
}

function TransportButton({
  active,
  icon,
  label,
  onPress
}: {
  active: boolean;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.transportButton,
        active && styles.transportButtonActive,
        pressed && { opacity: 0.8 }
      ]}
      onPress={onPress}
    >
      <Ionicons
        name={icon}
        size={18}
        color={active ? colors.primaryForeground : colors.foreground}
      />
      <Text style={[styles.transportButtonText, active && { color: colors.primaryForeground }]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background
  },
  scrollView: {
    flex: 1
  },
  scrollContent: {
    padding: 16
  },
  centered: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16
  },
  savingText: {
    color: colors.mutedForeground,
    fontSize: 16
  },
  infoBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: colors.primary + '15',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.primary + '30',
    padding: 14,
    marginBottom: 24
  },
  infoBannerText: {
    flex: 1,
    color: colors.primary,
    fontSize: 13,
    lineHeight: 18
  },
  successBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.success + '15',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.success + '30',
    padding: 14,
    marginBottom: 24
  },
  successBannerText: {
    color: colors.success,
    fontSize: 14,
    fontWeight: '600'
  },
  section: {
    marginBottom: 24
  },
  label: {
    color: colors.mutedForeground,
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10
  },
  helperText: {
    color: colors.mutedForeground,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 10
  },
  segmentedControl: {
    flexDirection: 'row',
    gap: 12
  },
  transportButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingVertical: 14,
    paddingHorizontal: 12
  },
  transportButtonActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary
  },
  transportButtonText: {
    color: colors.foreground,
    fontSize: 14,
    fontWeight: '600'
  },
  input: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 14,
    color: colors.foreground,
    fontSize: 16
  },
  primaryButton: {
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
  secondaryButton: {
    marginTop: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingVertical: 15,
    alignItems: 'center'
  },
  secondaryButtonText: {
    color: colors.foreground,
    fontSize: 15,
    fontWeight: '500'
  },
  disabledButton: {
    opacity: 0.5
  },
  fingerprintBox: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14
  },
  fingerprintText: {
    color: colors.foreground,
    fontFamily: 'Menlo',
    fontSize: 12
  },
  publicKeyBox: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14
  },
  publicKeyText: {
    color: colors.foreground,
    fontFamily: 'Menlo',
    fontSize: 11,
    lineHeight: 16
  },
  copyKeyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8
  },
  copyKeyLabel: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '500'
  },
  manualHint: {
    marginTop: 12,
    textAlign: 'center',
    color: colors.mutedForeground,
    fontSize: 13,
    lineHeight: 18
  }
});
