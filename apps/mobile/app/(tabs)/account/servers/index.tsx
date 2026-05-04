import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View
} from 'react-native';

import { type ThemeColors, useThemeColors, useThemedStyles } from '@/lib/colors';
import { Ionicons } from '@/lib/icons';
import { useServerConnections } from '@/lib/server-connections-context';
import type { Server, ServerStatus } from '@/lib/types';

function getStatusConfig(
  colors: ThemeColors
): Record<ServerStatus, { label: string; color: string }> {
  return {
    pending: { label: 'Pending', color: colors.mutedForeground },
    connected: { label: 'Connected', color: colors.success },
    error: { label: 'Error', color: colors.destructive }
  };
}

export default function ServersScreen() {
  const router = useRouter();
  const { servers, loading, refresh } = useServerConnections();
  const colors = useThemeColors();
  const styles = useThemedStyles(createStyles);
  const [refreshing, setRefreshing] = useState(false);
  const statusConfig = getStatusConfig(colors);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh])
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    refresh().finally(() => setRefreshing(false));
  }, [refresh]);

  function renderServer({ item }: { item: Server }) {
    const status = statusConfig[item.status] ?? statusConfig.pending;

    return (
      <Pressable
        style={({ pressed }) => [styles.serverCard, pressed && { opacity: 0.7 }]}
        onPress={() => router.push(`/(tabs)/account/servers/${item.id}`)}
      >
        <View style={styles.serverIcon}>
          <Ionicons name="server" size={24} color={colors.primary} />
        </View>
        <View style={styles.serverInfo}>
          <Text style={styles.serverLabel} numberOfLines={1}>
            {item.label}
          </Text>
          <Text style={styles.serverHost} numberOfLines={1}>
            {item.username}@{item.host}:{item.port} ·{' '}
            {item.transport === 'ssh' ? 'SSH' : 'Tailscale SSH'}
          </Text>
        </View>
        <View style={styles.serverStatus}>
          <View style={[styles.statusDot, { backgroundColor: status.color }]} />
          <Text style={[styles.statusText, { color: status.color }]}>{status.label}</Text>
        </View>
      </Pressable>
    );
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: 'Servers',
          headerRight: () => (
            <Pressable
              onPress={() => router.push('/(tabs)/account/servers/add')}
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
            >
              <Ionicons name="add" size={28} color={colors.primary} />
            </Pressable>
          )
        }}
      />

      {servers.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="server-outline" size={48} color={colors.mutedForeground} />
          <Text style={styles.emptyText}>No servers yet</Text>
          <Text style={styles.emptySubtext}>
            Add a server to verify SSH or Tailscale SSH access before launching remote agent jobs
          </Text>
          <Pressable
            style={({ pressed }) => [styles.addButton, pressed && { opacity: 0.7 }]}
            onPress={() => router.push('/(tabs)/account/servers/add')}
          >
            <Ionicons name="add" size={20} color={colors.primaryForeground} />
            <Text style={styles.addButtonText}>Add Server</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={servers}
          keyExtractor={item => item.id}
          renderItem={renderServer}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
            />
          }
        />
      )}
    </View>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background
    },
    centered: {
      flex: 1,
      backgroundColor: colors.background,
      justifyContent: 'center',
      alignItems: 'center'
    },
    list: {
      padding: 16,
      gap: 12
    },
    serverCard: {
      backgroundColor: colors.card,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 16,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12
    },
    serverIcon: {
      width: 44,
      height: 44,
      borderRadius: 10,
      backgroundColor: colors.secondary,
      justifyContent: 'center',
      alignItems: 'center'
    },
    serverInfo: {
      flex: 1
    },
    serverLabel: {
      color: colors.foreground,
      fontSize: 16,
      fontWeight: '600'
    },
    serverHost: {
      color: colors.mutedForeground,
      fontSize: 13,
      marginTop: 2
    },
    serverStatus: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6
    },
    statusDot: {
      width: 8,
      height: 8,
      borderRadius: 4
    },
    statusText: {
      fontSize: 12,
      fontWeight: '500'
    },
    empty: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 32
    },
    emptyText: {
      color: colors.foreground,
      fontSize: 18,
      fontWeight: '600',
      marginTop: 16
    },
    emptySubtext: {
      color: colors.mutedForeground,
      fontSize: 14,
      textAlign: 'center',
      marginTop: 8,
      marginBottom: 24
    },
    addButton: {
      backgroundColor: colors.primary,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 20,
      paddingVertical: 12,
      borderRadius: 10
    },
    addButtonText: {
      color: colors.primaryForeground,
      fontSize: 16,
      fontWeight: '600'
    }
  });
