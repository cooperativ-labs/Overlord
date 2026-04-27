import { Ionicons } from '@expo/vector-icons';
import { Tabs, useRouter } from 'expo-router';
import { StyleProp, TouchableOpacity, ViewStyle } from 'react-native';

import { colors } from '@/lib/colors';

function NewTicketTabButton({
  children,
  style
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const router = useRouter();
  return (
    <TouchableOpacity
      style={style}
      onPress={() => router.push('/(tabs)/tickets/create')}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel="New ticket"
    >
      {children}
    </TouchableOpacity>
  );
}

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.foreground,
        tabBarStyle: {
          backgroundColor: colors.background,
          borderTopColor: colors.border
        },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground
      }}
    >
      <Tabs.Screen
        name="feed/index"
        options={{
          title: 'Feed',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="newspaper-outline" size={size} color={color} />
          )
        }}
      />
      <Tabs.Screen
        name="tickets"
        options={{
          title: 'Tickets',
          headerShown: false,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="ticket-outline" size={size} color={color} />
          )
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: 'Account',
          headerShown: false,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person-outline" size={size} color={color} />
          )
        }}
      />
      <Tabs.Screen
        name="admin/index"
        options={{
          title: 'New Ticket',
          tabBarButton: props => <NewTicketTabButton {...props} />,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="add-circle-outline" size={size} color={color} />
          )
        }}
      />
    </Tabs>
  );
}
