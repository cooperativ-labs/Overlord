import { Redirect } from 'expo-router';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { ActivityIndicator, View } from 'react-native';

import { useAuth } from '@/lib/auth-context';
import { useThemeColors, useThemePreference } from '@/lib/colors';
import { Ionicons } from '@/lib/icons';

export default function TabLayout() {
  const { session, loading } = useAuth();
  const colors = useThemeColors();
  const { resolvedTheme } = useThemePreference();

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
    <NativeTabs
      key={resolvedTheme}
      disableTransparentOnScrollEdge
      backgroundColor={colors.card}
      tintColor={colors.primary}
      labelStyle={{
        default: { color: colors.mutedForeground },
        selected: { color: colors.primary }
      }}
      iconColor={{
        default: colors.mutedForeground,
        selected: colors.primary
      }}
    >
      {/* Create is listed first so it is the default tab on app open. */}
      <NativeTabs.Trigger name="create">
        <NativeTabs.Trigger.Icon
          sf="square.and.pencil"
          src={<NativeTabs.Trigger.VectorIcon family={Ionicons} name="add-circle-outline" />}
        />
        <NativeTabs.Trigger.Label>Create</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="feed">
        <NativeTabs.Trigger.Icon
          sf="newspaper"
          src={<NativeTabs.Trigger.VectorIcon family={Ionicons} name="newspaper-outline" />}
        />
        <NativeTabs.Trigger.Label>Feed</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="tickets">
        <NativeTabs.Trigger.Icon
          sf="ticket"
          src={<NativeTabs.Trigger.VectorIcon family={Ionicons} name="ticket-outline" />}
        />
        <NativeTabs.Trigger.Label>Tickets</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="servers">
        <NativeTabs.Trigger.Icon
          sf="server.rack"
          src={<NativeTabs.Trigger.VectorIcon family={Ionicons} name="server-outline" />}
        />
        <NativeTabs.Trigger.Label>Servers</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="account">
        <NativeTabs.Trigger.Icon
          sf="person"
          src={<NativeTabs.Trigger.VectorIcon family={Ionicons} name="person-outline" />}
        />
        <NativeTabs.Trigger.Label>Account</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
