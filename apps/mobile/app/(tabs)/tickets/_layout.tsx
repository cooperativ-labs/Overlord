import { Redirect, Stack } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';

import { useAuth } from '@/lib/auth-context';
import { useThemeColors } from '@/lib/colors';

export default function TicketsLayout() {
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
      <Stack.Screen
        name="index"
        options={{
          title: '',
          headerShown: true,
          headerTransparent: true
        }}
      />
      {/* <Stack.Screen name="create" options={{ title: 'New Ticket', presentation: 'modal' }} /> */}
      <Stack.Screen
        name="[ticketId]/index"
        options={{
          title: '',
          headerShown: true,
          // headerBackButtonDisplayMode:
          //   'minimal' as const,
          headerBackTitle: '',
          headerTitleAlign: 'center',
          headerShadowVisible: false
        }}
      />
    </Stack>
  );
}
