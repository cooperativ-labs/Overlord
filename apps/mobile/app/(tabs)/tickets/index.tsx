import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View
} from 'react-native';

import { colors } from '@/lib/colors';
import { getSupabase } from '@/lib/supabase';
import type { AssignedAgent, TicketListItem } from '@/lib/types';

const statusColors: Record<string, string> = {
  draft: colors.mutedForeground,
  'next-up': colors.primary,
  execute: colors.success,
  review: '#f59e0b',
  complete: colors.success,
  blocked: colors.destructive,
  cancelled: colors.mutedForeground,
  icebox: colors.mutedForeground
};

function formatAgentLabel(agent: AssignedAgent | null): string | null {
  if (!agent?.agent) return null;
  if (agent.model) return `${agent.agent} · ${agent.model}`;
  return agent.agent;
}

function formatDueDate(dueDatetime: string | null): string | null {
  if (!dueDatetime) return null;
  const due = new Date(dueDatetime);
  const now = new Date();
  const diffMs = due.getTime() - now.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return 'Overdue';
  if (diffDays === 0) return 'Due today';
  if (diffDays === 1) return 'Due tomorrow';
  return `Due ${due.toLocaleDateString()}`;
}

export default function TicketsScreen() {
  const router = useRouter();
  const [tickets, setTickets] = useState<TicketListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const handleCreateTicket = useCallback(() => {
    router.push('/(tabs)/tickets/create');
  }, [router]);

  const fetchTickets = useCallback(async () => {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('tickets')
      .select(
        'id, title, status, priority, execution_target, assigned_agent, ticket_sequence, due_datetime, updated_at'
      )
      .order('updated_at', { ascending: false })
      .limit(50);

    if (!error && data) {
      setTickets(data as TicketListItem[]);
      return;
    }

    if (error) {
      Alert.alert('Unable to load tickets', error.message);
    }
  }, []);

  useEffect(() => {
    fetchTickets().finally(() => setLoading(false));
  }, [fetchTickets]);

  // Realtime subscription + foreground refresh. The realtime channel is the
  // primary source of truth; we only fall back to polling when the channel
  // reports an error or closes, so we don't burn cellular bandwidth 3×/min.
  useEffect(() => {
    const supabase = getSupabase();
    let pollId: ReturnType<typeof setInterval> | null = null;

    const stopPolling = () => {
      if (pollId) {
        clearInterval(pollId);
        pollId = null;
      }
    };

    const startPolling = () => {
      if (pollId) return;
      pollId = setInterval(() => {
        void fetchTickets();
      }, 60_000);
    };

    const channel = supabase
      .channel('tickets-list-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tickets' },
        () => void fetchTickets()
      )
      .subscribe(status => {
        if (status === 'SUBSCRIBED') {
          stopPolling();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          startPolling();
          void fetchTickets();
        }
      });

    const appStateSubscription = AppState.addEventListener('change', nextAppState => {
      if (nextAppState === 'active') {
        void fetchTickets();
      }
    });

    return () => {
      stopPolling();
      appStateSubscription.remove();
      void supabase.removeChannel(channel);
    };
  }, [fetchTickets]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchTickets();
    setRefreshing(false);
  };

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
          headerRight: () => (
            <Pressable onPress={handleCreateTicket} hitSlop={8}>
              <Ionicons name="add-circle" size={28} color={colors.primary} />
            </Pressable>
          )
        }}
      />
      <FlatList
        data={tickets}
        keyExtractor={item => item.id}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
          />
        }
        renderItem={({ item }) => {
          const agentLabel = formatAgentLabel(item.assigned_agent);
          const dueLabel = formatDueDate(item.due_datetime);
          const isOverdue = dueLabel === 'Overdue';

          return (
            <Pressable
              style={styles.card}
              onPress={() => router.push(`/(tabs)/tickets/${item.id}`)}
            >
              <View style={styles.cardHeader}>
                <Text style={styles.sequence}>#{item.ticket_sequence}</Text>
                <View
                  style={[
                    styles.statusDot,
                    { backgroundColor: statusColors[item.status] ?? colors.mutedForeground }
                  ]}
                />
                <Text style={styles.status}>{item.status}</Text>
                <View style={{ flex: 1 }} />
                <View style={styles.targetBadge}>
                  <Ionicons
                    name={
                      item.execution_target === 'agent' ? 'hardware-chip-outline' : 'person-outline'
                    }
                    size={12}
                    color={colors.secondaryForeground}
                  />
                  <Text style={styles.targetText}>{item.execution_target}</Text>
                </View>
              </View>
              <Text style={styles.title} numberOfLines={2}>
                {item.title || 'Untitled'}
              </Text>
              <View style={styles.metaRow}>
                <Text style={styles.meta}>{item.priority}</Text>
                {agentLabel && (
                  <>
                    <Text style={styles.metaSep}>·</Text>
                    <Ionicons
                      name="hardware-chip-outline"
                      size={11}
                      color={colors.mutedForeground}
                    />
                    <Text style={styles.meta}>{agentLabel}</Text>
                  </>
                )}
              </View>
              {dueLabel && (
                <Text style={[styles.dueText, isOverdue && styles.dueOverdue]}>{dueLabel}</Text>
              )}
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="ticket-outline" size={48} color={colors.mutedForeground} />
            <Text style={styles.emptyText}>No tickets yet</Text>
          </View>
        }
        contentContainerStyle={tickets.length === 0 ? styles.emptyContainer : styles.list}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background
  },
  list: {
    padding: 16
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.border
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 6
  },
  sequence: {
    color: colors.mutedForeground,
    fontSize: 13,
    fontWeight: '600',
    fontVariant: ['tabular-nums']
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginLeft: 4
  },
  status: {
    color: colors.secondaryForeground,
    fontSize: 13,
    textTransform: 'capitalize'
  },
  targetBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.secondary,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6
  },
  targetText: {
    color: colors.secondaryForeground,
    fontSize: 11,
    fontWeight: '500',
    textTransform: 'capitalize'
  },
  title: {
    color: colors.foreground,
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 6
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4
  },
  meta: {
    color: colors.mutedForeground,
    fontSize: 13,
    textTransform: 'capitalize'
  },
  metaSep: {
    color: colors.mutedForeground,
    fontSize: 13
  },
  dueText: {
    color: colors.mutedForeground,
    fontSize: 12,
    marginTop: 6
  },
  dueOverdue: {
    color: colors.destructive,
    fontWeight: '600'
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center'
  },
  empty: {
    alignItems: 'center',
    paddingHorizontal: 32
  },
  emptyText: {
    color: colors.foreground,
    fontSize: 18,
    fontWeight: '600',
    marginTop: 16
  }
});
