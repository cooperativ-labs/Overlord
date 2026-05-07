import { Stack } from 'expo-router';
import type { TextStyle } from 'react-native';

import { useThemeColors } from '@/lib/colors';

export default function FeedLayout() {
  const colors = useThemeColors();
  return (
    <Stack>
      <Stack.Screen
        name="index"
        options={{
          headerShown: true,
          headerTransparent: true,
          headerShadowVisible: false,
          title: '',
          headerTitleAlign: 'left',
          headerBackTitle: '',
          headerBackTitleStyle: { color: colors.foreground } as TextStyle
        }}
      />
    </Stack>
  );
}
