import { Stack } from 'expo-router';

import { colors } from '@/lib/colors';

export default function AccountLayout() {
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
