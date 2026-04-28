import { Redirect, Stack } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';

import { useAuth } from '@/lib/auth-context';
import { useThemeColors } from '@/lib/colors';

export default function AccountLayout() {
  const { session, loading } = useAuth();
  const colors = useThemeColors();

  if (loading) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: colors.background
        }}
      >
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!session) {
    return <Redirect href="/(auth)/login" />;
  }

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.foreground
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Account' }} />
      <Stack.Screen name="servers" options={{ headerShown: false }} />
      <Stack.Screen name="security" options={{ title: 'Security' }} />
    </Stack>
  );
}
