import { Stack } from 'expo-router';

import { colors } from '@/lib/colors';

export default function ServersLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.foreground
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Servers' }} />
      <Stack.Screen name="add" options={{ title: 'Add Server', presentation: 'modal' }} />
      <Stack.Screen name="[serverId]/index" options={{ title: '' }} />
    </Stack>
  );
}
