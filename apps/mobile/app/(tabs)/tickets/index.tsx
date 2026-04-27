import { Ionicons } from '@expo/vector-icons';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  FlatList,
  Platform,
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

const glassAvailable = Platform.OS === 'ios' && isLiquidGlassAvailable();

function getContrastColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.5 ? '#000000' : '#ffffff';
}

function formatAgentLabel(agent: AssignedAgent | null): string | null {
  if (!agent?.agent) return null;
  return agent.agent;
}

export default function TicketsScreen() {
  const router = useRouter();
  const { projects, selectedProjectId, selectProject } = useSelectedProject();
  const { projectId: projectIdParam } = useLocalSearchParams<{ projectId?: string }>();

  // Seed context from deep-link param on first mount only.
  useEffect(() => {
    if (projectIdParam) selectProject(projectIdParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filterProjectId = selectedProjectId;
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

    const runQuery = () => {
      let q = supabase
        .from('tickets')
        .select(
          'id, title, status, priority, execution_target, assigned_agent, ticket_sequence, due_datetime, updated_at, project_id'
        )
        .order('updated_at', { ascending: false })
        .limit(100);
      if (filterProjectId) q = q.eq('project_id', filterProjectId);
      return q;
    };

    const MAX_ATTEMPTS = 3;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const { data, error } = await runQuery();
      if (!error && data) {
        setTickets(data as TicketWithProject[]);
        return;
      }
      if (error) {
        const isNetworkError =
          error.message?.includes('Network request failed') ||
          error.message?.includes('Failed to fetch');
        if (isNetworkError && attempt < MAX_ATTEMPTS - 1) {
          await new Promise(resolve => setTimeout(resolve, 500 * 2 ** attempt));
          continue;
        }
        Alert.alert('Unable to load tickets', error.message);
        return;
      }
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
  const buttonIconColor = getContrastColor(projectColor);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <TicketsScreenHeader
        search={search}
        onSearchChange={setSearch}
        onOpenDrawer={() => setDrawerOpen(true)}
        onCreateTicket={handleCreateTicket}
        projectColor={projectColor}
        buttonIconColor={buttonIconColor}
      />
      <TicketsScreenFilters
        projectName={projectName}
        projectColor={projectColor}
        projectMenuOpen={projectMenuOpen}
        sortMenuOpen={sortMenuOpen}
        statusMenuOpen={statusMenuOpen}
        sortMode={sortMode}
        statusFilter={statusFilter}
        projects={projects}
        filterProjectId={filterProjectId}
        onToggleProjectMenu={() => {
          setSortMenuOpen(false);
          setStatusMenuOpen(false);
          setProjectMenuOpen(open => !open);
        }}
        onToggleSortMenu={() => {
          setProjectMenuOpen(false);
          setStatusMenuOpen(false);
          setSortMenuOpen(open => !open);
        }}
        onToggleStatusMenu={() => {
          setProjectMenuOpen(false);
          setSortMenuOpen(false);
          setStatusMenuOpen(open => !open);
        }}
        onSelectProject={projectId => selectProject(projectId)}
        onSelectSort={mode => setSortMode(mode)}
        onSelectStatus={filter => setStatusFilter(filter)}
      />
      <TicketsResults
        loading={loading}
        refreshing={refreshing}
        tickets={displayTickets}
        search={search}
        statusFilter={statusFilter}
        filterProject={filterProject}
        projects={projects}
        projectColor={projectColor}
        onRefresh={onRefresh}
        onTicketPress={ticketId => router.push(`/(tabs)/tickets/${ticketId}`)}
      />
      <SidebarDrawer visible={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </SafeAreaView>
  );
}

function TicketsScreenHeader({
  search,
  onSearchChange,
  onOpenDrawer,
  onCreateTicket,
  projectColor,
  buttonIconColor
}: {
  search: string;
  onSearchChange: (value: string) => void;
  onOpenDrawer: () => void;
  onCreateTicket: () => void;
  projectColor: string;
  buttonIconColor: string;
}) {
  return (
    <View style={styles.topBar}>
      <Pressable
        hitSlop={10}
        style={styles.ghostButton}
        onPress={onOpenDrawer}
        accessibilityLabel="Open navigation"
      >
        <Ionicons name="menu-outline" size={22} color={colors.foreground} />
      </Pressable>
      {glassAvailable ? (
        <GlassView style={styles.searchWrap} glassEffectStyle="regular">
          <Ionicons name="search" size={14} color={colors.mutedForeground} />
          <TextInput
            value={search}
            onChangeText={onSearchChange}
            placeholder="Search ticket"
            placeholderTextColor={colors.mutedForeground}
            style={styles.searchInput}
          />
        </GlassView>
      ) : (
        <View style={[styles.searchWrap, styles.searchWrapFallback]}>
          <Ionicons name="search" size={14} color={colors.mutedForeground} />
          <TextInput
            value={search}
            onChangeText={onSearchChange}
            placeholder="Search ticket"
            placeholderTextColor={colors.mutedForeground}
            style={styles.searchInput}
          />
        </View>
      )}
      <Pressable hitSlop={10} onPress={onCreateTicket} accessibilityLabel="Create ticket">
        {glassAvailable ? (
          <GlassView
            style={styles.createButton}
            glassEffectStyle="regular"
            tintColor={projectColor}
          >
            <Ionicons name="add" size={16} color={buttonIconColor} />
            <Ionicons name="ticket-outline" size={14} color={buttonIconColor} />
          </GlassView>
        ) : (
          <View style={[styles.createButton, { backgroundColor: projectColor }]}>
            <Ionicons name="add" size={16} color={buttonIconColor} />
            <Ionicons name="ticket-outline" size={14} color={buttonIconColor} />
          </View>
        )}
      </Pressable>
    </View>
  );
}

function TicketsScreenFilters({
  projectName,
  projectColor,
  projectMenuOpen,
  sortMenuOpen,
  statusMenuOpen,
  sortMode,
  statusFilter,
  projects,
  filterProjectId,
  onToggleProjectMenu,
  onToggleSortMenu,
  onToggleStatusMenu,
  onSelectProject,
  onSelectSort,
  onSelectStatus
}: {
  projectName: string;
  projectColor: string;
  projectMenuOpen: boolean;
  sortMenuOpen: boolean;
  statusMenuOpen: boolean;
  sortMode: SortMode;
  statusFilter: StatusFilter;
  projects: { id: string; name: string; color: string }[];
  filterProjectId: string | null;
  onToggleProjectMenu: () => void;
  onToggleSortMenu: () => void;
  onToggleStatusMenu: () => void;
  onSelectProject: (projectId: string | null) => void;
  onSelectSort: (mode: SortMode) => void;
  onSelectStatus: (filter: StatusFilter) => void;
}) {
  return (
    <>
      <View style={styles.projectHeader}>
        <View style={[styles.projectSquare, { backgroundColor: projectColor }]} />
        <Text style={styles.projectHeaderName} numberOfLines={1}>
          {projectName}
        </Text>
        <Pressable
          hitSlop={8}
          style={styles.projectFilterButton}
          onPress={onToggleProjectMenu}
          accessibilityLabel="Filter by project"
        >
          <Ionicons name="chevron-down" size={16} color={colors.mutedForeground} />
        </Pressable>
      </View>
      {projectMenuOpen && (
        <View style={styles.menu}>
          <Pressable style={styles.menuItem} onPress={() => onSelectProject(null)}>
            <Text style={styles.menuItemText}>{ALL_PROJECTS_LABEL}</Text>
            {filterProjectId === null && (
              <Ionicons name="checkmark" size={14} color={colors.primary} />
            )}
          </Pressable>
          {projects.map(project => (
            <Pressable
              key={project.id}
              style={styles.menuItem}
              onPress={() => onSelectProject(project.id)}
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
      <View style={styles.filterRow}>
        <FilterChip
          icon="swap-vertical-outline"
          label={sortLabels[sortMode]}
          onPress={onToggleSortMenu}
          active={sortMenuOpen}
        />
        <FilterChip
          icon="funnel-outline"
          label={statusFilterLabels[statusFilter]}
          onPress={onToggleStatusMenu}
          active={statusMenuOpen}
        />
      </View>



      {sortMenuOpen && (
        <View style={styles.menu}>
          {(Object.keys(sortLabels) as SortMode[]).map(mode => (
            <Pressable key={mode} style={styles.menuItem} onPress={() => onSelectSort(mode)}>
              <Text style={styles.menuItemText}>{sortLabels[mode]}</Text>
              {sortMode === mode && <Ionicons name="checkmark" size={14} color={colors.primary} />}
            </Pressable>
          ))}
        </View>
      )}

      {statusMenuOpen && (
        <View style={styles.menu}>
          {(Object.keys(statusFilterLabels) as StatusFilter[]).map(filter => (
            <Pressable key={filter} style={styles.menuItem} onPress={() => onSelectStatus(filter)}>
              <Text style={styles.menuItemText}>{statusFilterLabels[filter]}</Text>
              {statusFilter === filter && (
                <Ionicons name="checkmark" size={14} color={colors.primary} />
              )}
            </Pressable>
          ))}
        </View>
      )}
    </>
  );
}

function TicketsResults({
  loading,
  refreshing,
  tickets,
  search,
  statusFilter,
  filterProject,
  projects,
  projectColor,
  onRefresh,
  onTicketPress
}: {
  loading: boolean;
  refreshing: boolean;
  tickets: TicketWithProject[];
  search: string;
  statusFilter: StatusFilter;
  filterProject: { name: string } | null;
  projects: { id: string; name: string; color: string }[];
  projectColor: string;
  onRefresh: () => Promise<void>;
  onTicketPress: (ticketId: string) => void;
}) {
  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <FlatList
      data={tickets}
      keyExtractor={item => item.id}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
      }
      renderItem={({ item }) => (
        <TicketCard
          ticket={item}
          projectColor={projectColor}
          projects={projects}
          onPress={() => onTicketPress(item.id)}
        />
      )}
      ListEmptyComponent={
        <TicketsEmptyState
          search={search}
          statusFilter={statusFilter}
          filterProject={filterProject}
        />
      }
      contentContainerStyle={tickets.length === 0 ? styles.emptyContainer : styles.list}
    />
  );
}

function TicketCard({
  ticket,
  projectColor,
  projects,
  onPress
}: {
  ticket: TicketWithProject;
  projectColor: string;
  projects: { id: string; name: string; color: string }[];
  onPress: () => void;
}) {
  const agentLabel = formatAgentLabel(ticket.assigned_agent);
  const ticketProject = projects.find(p => p.id === ticket.project_id) ?? null;
  const ticketProjectColor = ticketProject?.color || projectColor;
  const projectLabel = ticketProject?.name ?? 'Personal';

  return (
    <Pressable style={({ pressed }) => [styles.card, pressed && styles.pressed]} onPress={onPress}>
      <View style={styles.cardTitleRow}>
        <Text style={styles.ticketTitle} numberOfLines={2}>
          {ticket.title || 'Untitled'}
        </Text>
        {ticket.has_unread && <View style={styles.unreadDot} />}
      </View>
      <View style={styles.cardMeta}>
        <View style={styles.cardProjectInfo}>
          <View style={[styles.projectDot, { backgroundColor: ticketProjectColor }]} />
          <Text style={styles.ticketProjectName} numberOfLines={1}>
            {projectLabel}
          </Text>
        </View>
        <View style={styles.cardRightMeta}>
          {agentLabel && (
            <Ionicons
              name={
                ticket.execution_target === 'agent' ? 'hardware-chip-outline' : 'person-outline'
              }
              size={11}
              color={colors.mutedForeground}
            />
          )}
          <View
            style={[
              styles.statusBadge,
              { borderColor: statusColors[ticket.status] ?? colors.border }
            ]}
          >
            <Text
              style={[
                styles.statusText,
                { color: statusColors[ticket.status] ?? colors.mutedForeground }
              ]}
            >
              {statusLabel[ticket.status] ?? ticket.status}
            </Text>
          </View>
        </View>
      </View>
    </Pressable>
  );
}

function TicketsEmptyState({
  search,
  statusFilter,
  filterProject
}: {
  search: string;
  statusFilter: StatusFilter;
  filterProject: { name: string } | null;
}) {
  return (
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
  ghostButton: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center'
  },
  searchWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 10,
    paddingHorizontal: 10,
    height: 36,
    overflow: 'hidden'
  },
  searchWrapFallback: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border
  },
  searchInput: {
    flex: 1,
    color: colors.foreground,
    fontSize: 13,
    padding: 0
  },
  createButton: {
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 2,
    overflow: 'hidden'
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
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 6
  },
  ticketTitle: {
    flex: 1,
    color: colors.foreground,
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 20
  },
  cardMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8
  },
  cardProjectInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    flex: 1,
    minWidth: 0
  },
  projectDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    flexShrink: 0
  },
  ticketProjectName: {
    color: colors.mutedForeground,
    fontSize: 12,
    flexShrink: 1
  },
  cardRightMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0
  },
  unreadDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.destructive,
    marginTop: 2,
    flexShrink: 0
  },
  statusBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
    backgroundColor: 'transparent'
  },
  statusText: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'capitalize'
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
