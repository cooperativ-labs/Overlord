import { useRouter } from 'expo-router';
import { Fingerprint } from 'lucide-react-native';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';
import { Path, Svg } from 'react-native-svg';

import appIcon from '@/assets/icon.png';
import { useAuth } from '@/lib/auth-context';
import { type ThemeColors, useThemeColors, useThemedStyles } from '@/lib/colors';
import { PasskeyCancelledError } from '@/lib/passkey';
import { supabaseRuntimeInfo } from '@/lib/supabase';

export default function LoginScreen() {
  const router = useRouter();
  const { signIn, signInWithGithub, signInWithBitbucket, signInWithPasskey } = useAuth();
  const colors = useThemeColors();
  const styles = useThemedStyles(createStyles);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [githubLoading, setGithubLoading] = useState(false);
  const [bitbucketLoading, setBitbucketLoading] = useState(false);
  const [passkeyLoading, setPasskeyLoading] = useState(false);

  const handleSignIn = async () => {
    if (!email || !password) {
      Alert.alert('Error', 'Please enter your email and password.');
      return;
    }

    setLoading(true);
    try {
      await signIn(email, password);
      router.replace('/(tabs)/create');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'An error occurred';
      const debugContext = __DEV__
        ? `\n\nSupabase host: ${supabaseRuntimeInfo.host}\nKey: ${supabaseRuntimeInfo.publishableKeyPrefix}...`
        : '';
      Alert.alert('Sign In Failed', `${message}${debugContext}`);
    } finally {
      setLoading(false);
    }
  };

  const handlePasskeySignIn = async () => {
    setPasskeyLoading(true);
    try {
      await signInWithPasskey();
      router.replace('/(tabs)/create');
    } catch (error) {
      // A user-cancelled sheet is not an error worth interrupting them over.
      if (error instanceof PasskeyCancelledError) {
        return;
      }
      const message = error instanceof Error ? error.message : 'An error occurred';
      const debugContext = __DEV__
        ? `\n\nSupabase host: ${supabaseRuntimeInfo.host}\nKey: ${supabaseRuntimeInfo.publishableKeyPrefix}...`
        : '';
      Alert.alert('Passkey Sign In Failed', `${message}${debugContext}`);
    } finally {
      setPasskeyLoading(false);
    }
  };

  const handleGithubSignIn = async () => {
    setGithubLoading(true);
    try {
      await signInWithGithub();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'An error occurred';
      const debugContext = __DEV__
        ? `\n\nSupabase host: ${supabaseRuntimeInfo.host}\nKey: ${supabaseRuntimeInfo.publishableKeyPrefix}...`
        : '';
      Alert.alert('GitHub Sign In Failed', `${message}${debugContext}`);
    } finally {
      setGithubLoading(false);
    }
  };

  const handleBitbucketSignIn = async () => {
    setBitbucketLoading(true);
    try {
      await signInWithBitbucket();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'An error occurred';
      const debugContext = __DEV__
        ? `\n\nSupabase host: ${supabaseRuntimeInfo.host}\nKey: ${supabaseRuntimeInfo.publishableKeyPrefix}...`
        : '';
      Alert.alert('Bitbucket Sign In Failed', `${message}${debugContext}`);
    } finally {
      setBitbucketLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.logoContainer}>
          <Image source={appIcon} style={styles.logo} resizeMode="contain" />
        </View>

        <View style={styles.inner}>
          <Text style={styles.subtitle}>Sign in to your account</Text>

          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor={colors.mutedForeground}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
          />

          <TextInput
            style={styles.input}
            placeholder="Password"
            placeholderTextColor={colors.mutedForeground}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            textContentType="password"
          />

          <Pressable
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleSignIn}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color={colors.primaryForeground} />
            ) : (
              <Text style={styles.buttonText}>Sign In</Text>
            )}
          </Pressable>

          <View style={styles.divider}>
            <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
            <Text style={[styles.dividerText, { color: colors.mutedForeground }]}>or</Text>
            <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
          </View>

          <Pressable
            style={[styles.githubButton, passkeyLoading && styles.buttonDisabled]}
            onPress={handlePasskeySignIn}
            disabled={passkeyLoading}
          >
            {passkeyLoading ? (
              <ActivityIndicator color={colors.foreground} />
            ) : (
              <>
                <Fingerprint size={20} color={colors.foreground} />
                <Text style={[styles.githubButtonText, { color: colors.foreground }]}>
                  Sign in with passkey
                </Text>
              </>
            )}
          </Pressable>

          <Pressable
            style={[styles.githubButton, githubLoading && styles.buttonDisabled]}
            onPress={handleGithubSignIn}
            disabled={githubLoading}
          >
            {githubLoading ? (
              <ActivityIndicator color={colors.foreground} />
            ) : (
              <>
                <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <Path
                    d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"
                    fill={colors.foreground}
                  />
                </Svg>
                <Text style={[styles.githubButtonText, { color: colors.foreground }]}>
                  Continue with GitHub
                </Text>
              </>
            )}
          </Pressable>

          <Pressable
            style={[styles.githubButton, bitbucketLoading && styles.buttonDisabled]}
            onPress={handleBitbucketSignIn}
            disabled={bitbucketLoading}
          >
            {bitbucketLoading ? (
              <ActivityIndicator color={colors.foreground} />
            ) : (
              <>
                <Svg width={20} height={20} viewBox="0 0 24 24" fill={colors.foreground}>
                  <Path d="M.778 1.213a.768.768 0 00-.768.892l3.263 19.81c.084.5.515.868 1.022.873H19.95a.772.772 0 00.77-.646l3.27-20.03a.768.768 0 00-.768-.892zM14.52 15.53H9.522L8.17 8.466h7.767z" />
                </Svg>
                <Text style={[styles.githubButtonText, { color: colors.foreground }]}>
                  Continue with Bitbucket
                </Text>
              </>
            )}
          </Pressable>

          {__DEV__ ? (
            <Text style={styles.debugInfo}>
              Debug bundle: {supabaseRuntimeInfo.host} ({supabaseRuntimeInfo.publishableKeyPrefix}
              ...)
            </Text>
          ) : null}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background
    },
    scrollContent: {
      flexGrow: 1,
      paddingHorizontal: 24,
      paddingVertical: 24,
      justifyContent: 'center'
    },
    logoContainer: {
      alignItems: 'center',
      marginBottom: 48
    },
    logo: {
      width: 100,
      height: 100,
      borderRadius: 20
    },
    inner: {
      gap: 12
    },
    subtitle: {
      fontSize: 18,
      fontWeight: '600',
      color: colors.foreground,
      textAlign: 'center',
      marginBottom: 20
    },
    input: {
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      paddingHorizontal: 16,
      paddingVertical: 14,
      fontSize: 16,
      color: colors.foreground,
      marginBottom: 8
    },
    button: {
      backgroundColor: colors.primary,
      borderRadius: 8,
      paddingVertical: 14,
      alignItems: 'center',
      marginTop: 8
    },
    buttonDisabled: {
      opacity: 0.7
    },
    buttonText: {
      color: colors.primaryForeground,
      fontSize: 16,
      fontWeight: '600'
    },
    divider: {
      flexDirection: 'row',
      alignItems: 'center',
      marginVertical: 24,
      gap: 12
    },
    dividerLine: {
      flex: 1,
      height: 1
    },
    dividerText: {
      fontSize: 14,
      fontWeight: '500'
    },
    githubButton: {
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      paddingVertical: 14,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10
    },
    githubButtonText: {
      fontSize: 16,
      fontWeight: '600'
    },
    debugInfo: {
      marginTop: 16,
      color: colors.mutedForeground,
      fontSize: 12,
      textAlign: 'center'
    }
  });
