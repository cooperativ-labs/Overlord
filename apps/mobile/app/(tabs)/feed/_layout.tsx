import { Stack } from 'expo-router';
import { Text, TextStyle, View } from 'react-native';

import { useThemeColors } from '@/lib/colors';

export default function FeedLayout() {
  const colors = useThemeColors();
  return (
    <Stack>
      <View style={{ backgroundColor: 'red', height: 100 }}>
        <Text>Header</Text>
      </View>
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
