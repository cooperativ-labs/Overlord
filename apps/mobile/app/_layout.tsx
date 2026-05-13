import * as Sentry from '@sentry/react-native';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { initialWindowMetrics, SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider } from '@/lib/auth-context';
import { type ThemeColors, ThemeProvider, useThemedStyles, useThemePreference } from '@/lib/colors';
import { NotificationsProvider } from '@/lib/notifications';
import { SelectedProjectProvider } from '@/lib/selected-project-context';
import { ServerConnectionsProvider } from '@/lib/server-connections-context';
import { isSupabaseConfigured, supabaseConfigError } from '@/lib/supabase';

Sentry.init({
  dsn: 'https://59bf9df007f49ae0c9bb7b7878ab4d47@o4508852831977472.ingest.us.sentry.io/4511274313449472',

  // Adds more context data to events (IP address, cookies, user, etc.)
  // For more information, visit: https://docs.sentry.io/platforms/react-native/data-management/data-collected/
  sendDefaultPii: true,

  // Enable Logs
  enableLogs: true,

  integrations: [Sentry.feedbackIntegration()]

  // uncomment the line below to enable Spotlight (https://spotlightjs.com)
  // spotlight: __DEV__,
});

SplashScreen.preventAutoHideAsync();

export default Sentry.wrap(function RootLayout() {
  return (
    <GestureHandlerRootView style={rootStyles.flex}>
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <ThemeProvider>
          <RootLayoutContent />
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
});

function RootLayoutContent() {
  useEffect(() => {
    SplashScreen.hideAsync();
  }, []);

  const styles = useThemedStyles(createStyles);
  const { resolvedTheme } = useThemePreference();

  if (!isSupabaseConfigured()) {
    return (
      <>
        <View style={styles.container}>
          <View style={styles.card}>
            <Text style={styles.title}>Mobile app configuration required</Text>
            <Text style={styles.body}>
              Add the Expo public Supabase values in `apps/mobile/.env`, then restart Expo.
            </Text>
            <Text style={styles.code}>{supabaseConfigError}</Text>
            <Text style={styles.hint}>
              You can copy `apps/mobile/.env.example` to `apps/mobile/.env` as a starting point.
            </Text>
          </View>
        </View>
        <StatusBar style={resolvedTheme === 'light' ? 'dark' : 'light'} />
      </>
    );
  }

  return (
    <AuthProvider>
      <NotificationsProvider>
        <ServerConnectionsProvider>
          <SelectedProjectProvider>
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="(auth)" />
            </Stack>
            <StatusBar style={resolvedTheme === 'light' ? 'dark' : 'light'} />
          </SelectedProjectProvider>
        </ServerConnectionsProvider>
      </NotificationsProvider>
    </AuthProvider>
  );
}

const rootStyles = StyleSheet.create({
  flex: { flex: 1 }
});

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      padding: 24,
      backgroundColor: colors.background
    },
    card: {
      width: '100%',
      maxWidth: 420,
      padding: 20,
      borderRadius: 16,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      gap: 12
    },
    title: {
      color: colors.foreground,
      fontSize: 22,
      fontWeight: '700'
    },
    body: {
      color: colors.secondaryForeground,
      fontSize: 15,
      lineHeight: 22
    },
    code: {
      color: colors.destructive,
      fontSize: 14,
      lineHeight: 20
    },
    hint: {
      color: colors.mutedForeground,
      fontSize: 14,
      lineHeight: 20
    }
  });
