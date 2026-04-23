import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SidebarDrawer } from '@/components/SidebarDrawer';
import { colors } from '@/lib/colors';
import { useSelectedProject } from '@/lib/selected-project-context';
import { getSupabase } from '@/lib/supabase';
import type { AssignedAgent, TicketListItem } from '@/lib/types';

type SortMode = 'updated' | 'created' | 'priority';
type StatusFilter = 'all' | 'open' | 'draft' | 'next-up' | 'execute' | 'review' | 'complete';

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

const statusLabel: Record<string, string> = {
  draft: 'Draft',
  'next-up': 'Next up',
  execute: 'Execute',
  review: 'Review',
  complete: 'Complete',
  blocked: 'Blocked',
  cancelled: 'Cancelled',
  icebox: 'Icebox'
};

const sortLabels: Record<SortMode, string> = {
  updated: 'Last updated',
  created: 'Recently created',
  priority: 'Priority'
};

const statusFilterLabels: Record<StatusFilter, string> = {
  all: 'All statuses',
  open: 'Open',
  draft: 'Draft',
  'next-up': 'Next up',
  execute: 'Executing',
  review: 'In review',
  complete: 'Complete'
};

type TicketWithProject = TicketListItem & {
  project_id: string | null;
  has_unread?: boolean;
};

const ALL_PROJECTS_LABEL = 'My Tickets';

function formatAgentLabel(agent: AssignedAgent | null): string | null {
  if (!agent?.agent) return null;
  return agent.agent;
}

export default function TicketsScreen() {
  const router = useRouter();
  const { projects } = useSelectedProject();
  const { projectId: projectIdParam } = useLocalSearchParams<{ projectId?: string }>();
  const [filterProjectId, setFilterProjectId] = useState<string | null>(projectIdParam ?? null);

  useEffect(() => {
    setFilterProjectId(projectIdParam ?? null);
  }, [projectIdParam]);
  const [tickets, setTickets] = useState<TicketWithProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('updated');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);

  const handleCreateTicket = useCallback(() => {
    router.push('/(tabs)/tickets/create');
  }, [router]);

  const fetchTickets = useCallback(async () => {
    const supabase = getSupabase();
    let query = supabase
      .from('tickets')
      .select(
        'id, title, status, priority, execution_target, assigned_agent, ticket_sequence, due_datetime, updated_at, project_id'
      )
      .order('updated_at', { ascending: false })
      .limit(100);

    if (filterProjectId) {
      query = query.eq('project_id', filterProjectId);
    }

    const { data, error } = await query;

    if (!error && data) {
      setTickets(data as TicketWithProject[]);
      return;
    }
    if (error) {
      Alert.alert('Unable to load tickets', error.message);
    }
  }, [filterProjectId]);

  useEffect(() => {
    setLoading(true);
    fetchTickets().finally(() => setLoading(false));
  }, [fetchTickets]);

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

  const displayTickets = useMemo(() => {
    let result = [...tickets];

    if (statusFilter !== 'all') {
      if (statusFilter === 'open') {
        result = result.filter(
          ticket => !['complete', 'cancelled', 'icebox'].includes(ticket.status)
        );
      } else {
        result = result.filter(ticket => ticket.status === statusFilter);
      }
    }

    if (search.trim()) {
      const needle = search.trim().toLowerCase();
      result = result.filter(ticket => {
        const title = (ticket.title ?? '').toLowerCase();
        return title.includes(needle) || String(ticket.ticket_sequence).includes(needle);
      });
    }

    const priorityWeight: Record<string, number> = {
      urgent: 0,
      high: 1,
      medium: 2,
      low: 3
    };

    if (sortMode === 'priority') {
      result.sort((a, b) => {
        return (priorityWeight[a.priority] ?? 99) - (priorityWeight[b.priority] ?? 99);
      });
    } else if (sortMode === 'created') {
      // We don't select created_at here; fallback to updated_at ordering (server already returns it).
      // tickets already ordered by updated_at desc; leave as is
    } else {
      // updated already default
    }

    return result;
  }, [tickets, statusFilter, search, sortMode]);

  const filterProject = useMemo(
    () => projects.find(p => p.id === filterProjectId) ?? null,
    [projects, filterProjectId]
  );
  const projectColor = filterProject?.color || colors.primary;
  const projectName = filterProject?.name ?? ALL_PROJECTS_LABEL;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Top toolbar */}
      <View style={styles.topBar}>
        <Pressable
          hitSlop={10}
          style={styles.iconButton}
          onPress={() => setDrawerOpen(true)}
          accessibilityLabel="Open navigation"
        >
          <Ionicons name="menu-outline" size={20} color={colors.foreground} />
        </Pressable>
        <Pressable
          hitSlop={10}
          style={styles.iconButton}
          onPress={() => router.back()}
          accessibilityLabel="Back"
        >
          <Ionicons name="arrow-back" size={18} color={colors.foreground} />
        </Pressable>
        <View style={styles.searchWrap}>
          <Ionicons name="search" size={14} color={colors.mutedForeground} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search ticket"
            placeholderTextColor={colors.mutedForeground}
            style={styles.searchInput}
          />
        </View>
        <Pressable
          hitSlop={10}
          style={styles.createButton}
          onPress={handleCreateTicket}
          accessibilityLabel="Create ticket"
        >
          <Ionicons name="add" size={16} color={colors.foreground} />
          <Ionicons name="ticket-outline" size={14} color={colors.foreground} />
        </Pressable>
      </View>

      {/* Project header */}
      <View style={styles.projectHeader}>
        <View style={[styles.projectSquare, { backgroundColor: projectColor }]} />
        <Text style={styles.projectHeaderName} numberOfLines={1}>
          {projectName}
        </Text>
        <Pressable
          hitSlop={8}
          style={styles.projectFilterButton}
          onPress={() => {
            setSortMenuOpen(false);
            setStatusMenuOpen(false);
            setProjectMenuOpen(open => !open);
          }}
          accessibilityLabel="Filter by project"
        >
          <Ionicons name="chevron-down" size={16} color={colors.mutedForeground} />
        </Pressable>
      </View>

      {/* Filter chips */}
      <View style={styles.filterRow}>
        <FilterChip
          icon="folder-open-outline"
          label={projectName}
          onPress={() => {
            setSortMenuOpen(false);
            setStatusMenuOpen(false);
            setProjectMenuOpen(open => !open);
          }}
          active={projectMenuOpen}
        />
        <FilterChip
          icon="swap-vertical-outline"
          label={sortLabels[sortMode]}
          onPress={() => {
            setProjectMenuOpen(false);
            setStatusMenuOpen(false);
            setSortMenuOpen(open => !open);
          }}
          active={sortMenuOpen}
        />
        <FilterChip
          icon="funnel-outline"
          label={statusFilterLabels[statusFilter]}
          onPress={() => {
            setProjectMenuOpen(false);
            setSortMenuOpen(false);
            setStatusMenuOpen(open => !open);
          }}
          active={statusMenuOpen}
        />
      </View>

      {projectMenuOpen && (
        <View style={styles.menu}>
          <Pressable
            style={styles.menuItem}
            onPress={() => {
              setFilterProjectId(null);
              setProjectMenuOpen(false);
            }}
          >
            <Text style={styles.menuItemText}>{ALL_PROJECTS_LABEL}</Text>
            {filterProjectId === null && (
              <Ionicons name="checkmark" size={14} color={colors.primary} />
            )}
          </Pressable>
          {projects.map(project => (
            <Pressable
              key={project.id}
              style={styles.menuItem}
              onPress={() => {
                setFilterProjectId(project.id);
                setProjectMenuOpen(false);
              }}
            >
              <View style={styles.projectMenuLabel}>
                <View style={[styles.projectMenuDot, { backgroundColor: project.color }]} />
                <Text style={styles.menuItemText}>{project.name}</Text>
              </View>
              {filterProjectId === project.id && (
                <Ionicons name="checkmark" size={14} color={colors.primary} />
              )}
            </Pressable>
          ))}
        </View>
      )}

      {sortMenuOpen && (
        <View style={styles.menu}>
          {(Object.keys(sortLabels) as SortMode[]).map(mode => (
            <Pressable
              key={mode}
              style={styles.menuItem}
              onPress={() => {
                setSortMode(mode);
                setSortMenuOpen(false);
              }}
            >
              <Text style={styles.menuItemText}>{sortLabels[mode]}</Text>
              {sortMode === mode && <Ionicons name="checkmark" size={14} color={colors.primary} />}
            </Pressable>
          ))}
        </View>
      )}

      {statusMenuOpen && (
        <View style={styles.menu}>
          {(Object.keys(statusFilterLabels) as StatusFilter[]).map(filter => (
            <Pressable
              key={filter}
              style={styles.menuItem}
              onPress={() => {
                setStatusFilter(filter);
                setStatusMenuOpen(false);
              }}
            >
              <Text style={styles.menuItemText}>{statusFilterLabels[filter]}</Text>
              {statusFilter === filter && (
                <Ionicons name="checkmark" size={14} color={colors.primary} />
              )}
            </Pressable>
          ))}
        </View>
      )}

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={displayTickets}
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
            const projectForTicket =
              projects.find(p => p.id === item.project_id)?.color || projectColor;
            const projectLabel = projects.find(p => p.id === item.project_id)?.name ?? 'Personal';
            return (
              <Pressable
                style={({ pressed }) => [styles.card, pressed && styles.pressed]}
                onPress={() => router.push(`/(tabs)/tickets/${item.id}`)}
              >
                <View style={styles.cardRow}>
                  <View style={[styles.ticketSquare, { backgroundColor: projectForTicket }]} />
                  <View style={styles.ticketTitleWrap}>
                    <Text style={styles.ticketTitle} numberOfLines={1}>
                      {item.title || 'Untitled'}
                    </Text>
                    {filterProjectId === null && (
                      <Text style={styles.ticketProjectName} numberOfLines={1}>
                        {projectLabel}
                      </Text>
                    )}
                  </View>
                  {item.has_unread && <View style={styles.unreadDot} />}
                </View>
                <View style={styles.actionRow}>
                  <Pressable
                    hitSlop={8}
                    style={styles.playButton}
                    onPress={() => router.push(`/(tabs)/tickets/${item.id}`)}
                  >
                    <Ionicons name="play-outline" size={12} color={colors.foreground} />
                  </Pressable>
                  <View
                    style={[
                      styles.statusBadge,
                      {
                        borderColor: statusColors[item.status] ?? colors.border
                      }
                    ]}
                  >
                    <Text
                      style={[
                        styles.statusText,
                        { color: statusColors[item.status] ?? colors.mutedForeground }
                      ]}
                    >
                      {statusLabel[item.status] ?? item.status}
                    </Text>
                  </View>
                  {agentLabel && (
                    <View style={styles.agentBadge}>
                      <Ionicons
                        name={
                          item.execution_target === 'agent'
                            ? 'hardware-chip-outline'
                            : 'person-outline'
                        }
                        size={11}
                        color={colors.success}
                      />
                      <Text style={styles.agentBadgeText}>
                        {item.execution_target === 'agent' ? 'Agent' : 'Human'}
                      </Text>
                    </View>
                  )}
                </View>
              </Pressable>
            );
          }}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="ticket-outline" size={48} color={colors.mutedForeground} />
              <Text style={styles.emptyText}>No tickets</Text>
              <Text style={styles.emptySub}>
                {search.trim() || statusFilter !== 'all'
                  ? 'Try clearing filters.'
                  : filterProject
                    ? `No tickets in ${filterProject.name}.`
                    : 'No tickets across your projects yet.'}
              </Text>
            </View>
          }
          contentContainerStyle={displayTickets.length === 0 ? styles.emptyContainer : styles.list}
        />
      )}

      <SidebarDrawer visible={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </SafeAreaView>
  );
}

function FilterChip({
  icon,
  label,
  onPress,
  active
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  active: boolean;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.chip, active && styles.chipActive, pressed && styles.pressed]}
      onPress={onPress}
    >
      <Ionicons name={icon} size={13} color={colors.foreground} />
      <Text style={styles.chipText}>{label}</Text>
    </Pressable>
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
    alignItems: 'center'
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 10
  },
  iconButton: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center'
  },
  searchWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.card,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 10,
    height: 34
  },
  searchInput: {
    flex: 1,
    color: colors.foreground,
    fontSize: 13,
    padding: 0
  },
  createButton: {
    height: 34,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 2
  },
  projectHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 10
  },
  projectSquare: {
    width: 14,
    height: 14,
    borderRadius: 3
  },
  projectHeaderName: {
    flex: 1,
    color: colors.foreground,
    fontSize: 17,
    fontWeight: '700'
  },
  projectFilterButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center'
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    paddingHorizontal: 16,
    paddingBottom: 10
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border
  },
  chipActive: {
    borderColor: colors.primary
  },
  chipText: {
    color: colors.foreground,
    fontSize: 13
  },
  menu: {
    marginHorizontal: 16,
    marginBottom: 6,
    backgroundColor: colors.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden'
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border
  },
  menuItemText: {
    color: colors.foreground,
    fontSize: 14
  },
  projectMenuLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  projectMenuDot: {
    width: 8,
    height: 8,
    borderRadius: 4
  },
  list: {
    paddingHorizontal: 12,
    paddingBottom: 16,
    gap: 8
  },
  pressed: {
    opacity: 0.8
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.border
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10
  },
  ticketTitleWrap: {
    flex: 1,
    gap: 3
  },
  ticketSquare: {
    width: 10,
    height: 10,
    borderRadius: 2
  },
  ticketTitle: {
    color: colors.foreground,
    fontSize: 15,
    fontWeight: '600'
  },
  ticketProjectName: {
    color: colors.mutedForeground,
    fontSize: 12
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.destructive
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
    marginLeft: 20
  },
  playButton: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.secondary,
    alignItems: 'center',
    justifyContent: 'center'
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
    backgroundColor: 'transparent'
  },
  statusText: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'capitalize'
  },
  agentBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(34, 197, 94, 0.4)',
    backgroundColor: 'rgba(34, 197, 94, 0.08)'
  },
  agentBadgeText: {
    color: colors.success,
    fontSize: 11,
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
  },
  emptySub: {
    color: colors.mutedForeground,
    fontSize: 14,
    textAlign: 'center',
    marginTop: 6
  }
});
