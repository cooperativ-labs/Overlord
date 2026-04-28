import { Stack } from 'expo-router';

import { useThemeColors } from '@/lib/colors';

export default function FeedLayout() {
  const colors = useThemeColors();

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.foreground
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Feed' }} />
    </Stack>
  );
}
