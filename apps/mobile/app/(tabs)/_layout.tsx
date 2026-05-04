import { Redirect } from 'expo-router';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { QuickCreateTicketModal } from '@/components/QuickCreateTicketModal';
import { useAuth } from '@/lib/auth-context';
import { useThemeColors } from '@/lib/colors';
import { Ionicons } from '@/lib/icons';

function AddTicketAccessory({ onPress }: { onPress: () => void }) {
  const colors = useThemeColors();
  const placement = NativeTabs.BottomAccessory.usePlacement();

  return (
    <View
      style={{
        flex: 1,
        justifyContent: 'center',
        alignItems: placement === 'inline' ? 'flex-end' : 'center',
        paddingRight: placement === 'inline' ? 16 : 0,
        paddingVertical: placement === 'inline' ? 0 : 12
      }}
    >
      <Pressable
        onPress={onPress}
        style={({ pressed }) => ({
          opacity: pressed ? 0.6 : 1,
          width: 36,
          height: 36,
          borderRadius: 18,
          backgroundColor: colors.primary,
          justifyContent: 'center',
          alignItems: 'center'
        })}
      >
        <Text style={{ color: '#fff', fontSize: 22, lineHeight: 24, fontWeight: '300' }}>+</Text>
      </Pressable>
    </View>
  );
}

export default function TabLayout() {
  const { session, loading } = useAuth();
  const colors = useThemeColors();
  const [quickCreateVisible, setQuickCreateVisible] = useState(false);

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
    <>
      <NativeTabs
        disableTransparentOnScrollEdge
        // minimizeBehavior="onScrollDown"
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
        {/* <NativeTabs.BottomAccessory>
          <AddTicketAccessory onPress={() => setQuickCreateVisible(true)} />
        </NativeTabs.BottomAccessory> */}
        <NativeTabs.Trigger name="feed">
          <NativeTabs.Trigger.Icon
            src={<NativeTabs.Trigger.VectorIcon family={Ionicons} name="newspaper-outline" />}
          />
          <NativeTabs.Trigger.Label>Feed</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="tickets">
          <NativeTabs.Trigger.Icon
            src={<NativeTabs.Trigger.VectorIcon family={Ionicons} name="ticket-outline" />}
          />
          <NativeTabs.Trigger.Label>Tickets</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="account">
          <NativeTabs.Trigger.Icon
            src={<NativeTabs.Trigger.VectorIcon family={Ionicons} name="person-outline" />}
          />
          <NativeTabs.Trigger.Label>Account</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
      </NativeTabs>
      <QuickCreateTicketModal
        visible={quickCreateVisible}
        onClose={() => setQuickCreateVisible(false)}
      />
    </>
  );
}
