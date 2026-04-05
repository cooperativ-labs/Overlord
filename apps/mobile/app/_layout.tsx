import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AuthProvider } from '@/lib/auth-context';
import { colors } from '@/lib/colors';
import { ServerConnectionsProvider } from '@/lib/server-connections-context';
import { isSupabaseConfigured, supabaseConfigError } from '@/lib/supabase';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  useEffect(() => {
    SplashScreen.hideAsync();
  }, []);

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
        <StatusBar style="light" />
      </>
    );
  }

  return (
    <AuthProvider>
      <ServerConnectionsProvider>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="(auth)" />
        </Stack>
        <StatusBar style="light" />
      </ServerConnectionsProvider>
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
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
