import { Stack } from 'expo-router';

import { colors } from '@/lib/colors';

export default function TicketsLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.foreground,
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Tickets' }} />
      <Stack.Screen name="create" options={{ title: 'New Ticket', presentation: 'modal' }} />
      <Stack.Screen name="[ticketId]/index" options={{ title: '' }} />
    </Stack>
  );
}
