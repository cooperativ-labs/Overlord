import { Ionicons } from '@expo/vector-icons';
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
  View,
} from 'react-native';

import { colors } from '@/lib/colors';
import { useAuth } from '@/lib/auth-context';
import { getSupabase } from '@/lib/supabase';
import {
  generateKey,
  installPublicKey,
} from '@/modules/secure-enclave-ssh';

type Step = 'form' | 'generating' | 'install_key' | 'saving';

function parseServerPort(rawPort: string): number {
  const trimmed = rawPort.trim();
  if (!trimmed) return 22;

  const parsed = parseInt(trimmed, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : NaN;
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

  // Form fields
  const [label, setLabel] = useState('');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('');
  const [username, setUsername] = useState('');

  // SSH key installation
  const [step, setStep] = useState<Step>('form');
  const [publicKey, setPublicKey] = useState('');
  const [fingerprint, setFingerprint] = useState('');
  const [keyTag, setKeyTag] = useState('');
  const [isHardwareBacked, setIsHardwareBacked] = useState(false);
  const [password, setPassword] = useState('');
  const [installing, setInstalling] = useState(false);

  const canSubmit =
    label.trim().length > 0 &&
    host.trim().length > 0 &&
    username.trim().length > 0 &&
    Number.isFinite(parseServerPort(port));

  async function handleGenerateKey() {
    if (!canSubmit) return;

    setStep('generating');

    try {
      // Generate a unique tag for this server's key
      const tag = `com.cooperativ.overlord.ssh.${Date.now()}`;
      const result = await generateKey(tag);

      setKeyTag(tag);
      setPublicKey(result.publicKeyOpenSSH);
      setFingerprint(result.fingerprint);
      setIsHardwareBacked(result.isHardwareBacked);
      setStep('install_key');
    } catch (error) {
      setStep('form');
      Alert.alert(
        'Key Generation Failed',
        error instanceof Error ? error.message : 'Failed to generate SSH key'
      );
    }
  }

  async function handleInstallKey() {
    if (!password.trim()) {
      Alert.alert(
        'Password Required',
        isLikelyTailscaleHost(host)
          ? "Enter your server password, or any placeholder if this host only accepts Tailscale SSH. The value is used once and is not stored."
          : 'Enter your server password to install the SSH key. This password is used once and is not stored.'
      );
      return;
    }

    setInstalling(true);

    try {
      // SSH directly from the device to install the public key
      await installPublicKey(
        host.trim(),
        parseServerPort(port),
        username.trim(),
        password,
        publicKey
      );

      // Key installed successfully — save the server
      await saveServer(true);
    } catch (error) {
      Alert.alert(
        'Key Installation Failed',
        (error instanceof Error ? error.message : 'Failed to install SSH key') +
          '\n\nYou can save the server and install the key manually later.'
      );
    } finally {
      setInstalling(false);
    }
  }

  async function handleSaveWithoutInstalling() {
    await saveServer(false);
  }

  async function saveServer(keyInstalled: boolean) {
    setStep('saving');

    try {
      const supabase = getSupabase();

      // Get the user's organization
      const { data: orgMember, error: orgError } = await supabase
        .from('members')
        .select('organization_id')
        .eq('user_id', user!.id)
        .limit(1)
        .single();

      if (orgError || !orgMember) {
        throw new Error('Could not determine your organization');
      }

      const { error: insertError } = await supabase.from('servers').insert({
        user_id: user!.id,
        organization_id: orgMember.organization_id,
        label: label.trim(),
        host: host.trim(),
        port: parseServerPort(port),
        username: username.trim(),
        ssh_public_key: publicKey || null,
        ssh_key_fingerprint: fingerprint || null,
        secure_enclave_tag: keyTag || null,
        key_installed: keyInstalled,
        status: keyInstalled ? 'key_installed' : 'pending',
      });

      if (insertError) {
        throw new Error(insertError.message);
      }

      router.back();
    } catch (error) {
      setStep('install_key');
      Alert.alert(
        'Failed to Save',
        error instanceof Error ? error.message : 'An unexpected error occurred'
      );
    }
  }

  // Step 1: Form to collect server info
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
            headerTintColor: colors.foreground,
          }}
        />

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* Info Banner */}
          <View style={styles.infoBanner}>
            <Ionicons name="key-outline" size={18} color={colors.primary} />
            <Text style={styles.infoBannerText}>
              An SSH key pair will be generated on your device. When available, the private key is stored in the Secure Enclave hardware.
            </Text>
          </View>

          {/* Label */}
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

          {/* Host */}
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
          </View>

          {/* Port */}
          <View style={styles.section}>
            <Text style={styles.label}>Port</Text>
            <Text style={styles.helperText}>
              Leave blank for port 22. Tailscale SSH always uses port 22.
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

          {/* Username */}
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

          {/* Submit */}
          <Pressable
            style={({ pressed }) => [
              styles.primaryButton,
              (!canSubmit || step === 'generating') && styles.disabledButton,
              pressed && canSubmit && { opacity: 0.7 },
            ]}
            onPress={handleGenerateKey}
            disabled={!canSubmit || step === 'generating'}
          >
            {step === 'generating' ? (
              <>
                <ActivityIndicator size="small" color={colors.primaryForeground} />
                <Text style={styles.primaryButtonText}>Generating Key...</Text>
              </>
            ) : (
              <>
                <Ionicons name="key-outline" size={20} color={colors.primaryForeground} />
                <Text style={styles.primaryButtonText}>Generate SSH Key & Continue</Text>
              </>
            )}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // Step 2: Install key on server
  if (step === 'install_key') {
    return (
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={100}
      >
        <Stack.Screen
          options={{
            title: 'Install SSH Key',
            headerShown: true,
            headerStyle: { backgroundColor: colors.background },
            headerTintColor: colors.foreground,
          }}
        />

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* Key Generated Banner */}
          <View style={styles.successBanner}>
            <Ionicons name="checkmark-circle" size={20} color={colors.success} />
            <View style={{ flex: 1 }}>
              <Text style={styles.successBannerText}>SSH key generated successfully</Text>
              {!isHardwareBacked && (
                <Text style={[styles.successBannerText, { fontWeight: '400', fontSize: 12, marginTop: 2 }]}>
                  Software-backed key (Secure Enclave not available on this device)
                </Text>
              )}
            </View>
          </View>

          {/* Fingerprint */}
          <View style={styles.section}>
            <Text style={styles.label}>Key Fingerprint</Text>
            <View style={styles.fingerprintBox}>
              <Text style={styles.fingerprintText} selectable>
                {fingerprint}
              </Text>
            </View>
          </View>

          {/* Public Key (collapsed) */}
          <View style={styles.section}>
            <Text style={styles.label}>Public Key</Text>
            <View style={styles.publicKeyBox}>
              <Text style={styles.publicKeyText} numberOfLines={3} selectable>
                {publicKey}
              </Text>
            </View>
          </View>

          {/* Password for key installation */}
          <View style={styles.section}>
            <Text style={styles.label}>
              {isLikelyTailscaleHost(host) ? 'Password / Tailscale Fallback' : 'Server Password'}
            </Text>
            <Text style={styles.helperText}>
              {isLikelyTailscaleHost(host)
                ? "If this host uses Tailscale SSH, Overlord will try Tailscale's password-compatibility mode automatically. The password is never stored."
                : 'Enter your password once to install the SSH key. The password is not stored.'}
            </Text>
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder={
                isLikelyTailscaleHost(host)
                  ? 'Enter password or any placeholder'
                  : 'Enter server password'
              }
              placeholderTextColor={colors.mutedForeground}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          {isLikelyTailscaleHost(host) ? (
            <View style={styles.infoBanner}>
              <Ionicons name="git-network-outline" size={18} color={colors.primary} />
              <Text style={styles.infoBannerText}>
                This looks like a Tailscale host. Tailscale SSH only listens on port 22, and installing this key updates the host&apos;s regular
                {' '}~/.ssh/authorized_keys{` `}
                file for non-Tailscale SSH access later.
              </Text>
            </View>
          ) : null}

          {/* Install Key Button */}
          <Pressable
            style={({ pressed }) => [
              styles.primaryButton,
              installing && styles.disabledButton,
              pressed && !installing && { opacity: 0.7 },
            ]}
            onPress={handleInstallKey}
            disabled={installing}
          >
            {installing ? (
              <>
                <ActivityIndicator size="small" color={colors.primaryForeground} />
                <Text style={styles.primaryButtonText}>Installing Key...</Text>
              </>
            ) : (
              <>
                <Ionicons name="cloud-upload-outline" size={20} color={colors.primaryForeground} />
                <Text style={styles.primaryButtonText}>Install Key on Server</Text>
              </>
            )}
          </Pressable>

          {/* Save without installing */}
          <Pressable
            style={({ pressed }) => [styles.secondaryButton, pressed && { opacity: 0.7 }]}
            onPress={handleSaveWithoutInstalling}
            disabled={installing}
          >
            <Text style={styles.secondaryButtonText}>Save Without Installing</Text>
          </Pressable>

          <Text style={styles.manualHint}>
            You can also manually add the public key to your server's ~/.ssh/authorized_keys file.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // Step 3: Saving
  return (
    <View style={styles.centered}>
      <Stack.Screen
        options={{
          title: 'Saving...',
          headerShown: true,
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.foreground,
        }}
      />
      <ActivityIndicator size="large" color={colors.primary} />
      <Text style={styles.savingText}>Saving server...</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
  },
  centered: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  savingText: {
    color: colors.mutedForeground,
    fontSize: 16,
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
    marginBottom: 24,
  },
  infoBannerText: {
    flex: 1,
    color: colors.primary,
    fontSize: 13,
    lineHeight: 18,
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
    marginBottom: 24,
  },
  successBannerText: {
    color: colors.success,
    fontSize: 14,
    fontWeight: '600',
  },
  section: {
    marginBottom: 24,
  },
  label: {
    color: colors.mutedForeground,
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  helperText: {
    color: colors.mutedForeground,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 10,
  },
  input: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    color: colors.foreground,
    fontSize: 16,
  },
  fingerprintBox: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
  },
  fingerprintText: {
    color: colors.foreground,
    fontSize: 13,
    fontFamily: 'Menlo',
  },
  publicKeyBox: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
  },
  publicKeyText: {
    color: colors.mutedForeground,
    fontSize: 11,
    fontFamily: 'Menlo',
    lineHeight: 16,
  },
  primaryButton: {
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 12,
    marginBottom: 12,
  },
  primaryButtonText: {
    color: colors.primaryForeground,
    fontSize: 16,
    fontWeight: '600',
  },
  disabledButton: {
    opacity: 0.5,
  },
  secondaryButton: {
    backgroundColor: colors.secondary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 16,
  },
  secondaryButtonText: {
    color: colors.secondaryForeground,
    fontSize: 15,
    fontWeight: '600',
  },
  manualHint: {
    color: colors.mutedForeground,
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 17,
    paddingHorizontal: 16,
  },
});
