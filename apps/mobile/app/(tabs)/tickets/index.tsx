import { Ionicons } from '@expo/vector-icons';
import { addDays, format, isToday, parseISO, startOfDay, subDays } from 'date-fns';
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
import { type ThemeColors, useThemeColors, useThemedStyles } from '@/lib/colors';
import { useSelectedProject } from '@/lib/selected-project-context';
import { getSupabase } from '@/lib/supabase';
import { isTransientNetworkError } from '@/lib/transient-network-error';
import type { AssignedAgent, TicketListItem } from '@/lib/types';

type SortMode = 'updated' | 'created' | 'priority';
type StatusFilter = 'all' | 'open' | 'draft' | 'next-up' | 'execute' | 'review' | 'complete';
type ViewMode = 'list' | 'calendar';

function getStatusColors(colors: ThemeColors): Record<string, string> {
  return {
    draft: colors.mutedForeground,
    'next-up': colors.primary,
    execute: colors.success,
    review: '#f59e0b',
    complete: colors.success,
    blocked: colors.destructive,
    cancelled: colors.mutedForeground,
    icebox: colors.mutedForeground
  };
}

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
  created_at: string;
  project_id: string | null;
  has_unread?: boolean;
};

const ALL_PROJECTS_LABEL = 'My Tickets';
const CALENDAR_PAST_DAYS = 5;
const CALENDAR_FUTURE_DAYS = 24;
const CALENDAR_PAGE_SIZE = 21;

const glassAvailable = Platform.OS === 'ios' && isLiquidGlassAvailable();

function buildCalendarDays(from: Date, pastDays: number, futureDays: number): Date[] {
  const start = subDays(startOfDay(from), pastDays);
  return Array.from({ length: pastDays + futureDays + 1 }, (_, index) => addDays(start, index));
}

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
  const colors = useThemeColors();
  const styles = useThemedStyles(createStyles);
  const statusColors = getStatusColors(colors);

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
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('list');

  useEffect(() => {
    if (!filterProjectId) {
      setViewMode('list');
      setViewMenuOpen(false);
    }
  }, [filterProjectId]);

  const handleCreateTicket = useCallback(
    (dueDate?: string) => {
      router.push({
        pathname: '/(tabs)/tickets/create',
        params: {
          ...(filterProjectId ? { projectId: filterProjectId } : {}),
          ...(dueDate ? { dueDate } : {})
        }
      });
    },
    [filterProjectId, router]
  );

  const fetchTickets = useCallback(
    async (options?: { suppressTransientNetworkAlert?: boolean }) => {
      const supabase = getSupabase();

      const runQuery = () => {
        let q = supabase
          .from('tickets')
          .select(
            'id, title, status, priority, execution_target, assigned_agent, ticket_sequence, due_datetime, created_at, updated_at, project_id'
          )
          .order('updated_at', { ascending: false })
          .limit(100);
        if (filterProjectId) q = q.eq('project_id', filterProjectId);
        return q;
      };

      const MAX_ATTEMPTS = options?.suppressTransientNetworkAlert ? 4 : 3;
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const { data, error } = await runQuery();
        if (!error && data) {
          setTickets(data as TicketWithProject[]);
          return;
        }
        if (error) {
          const isNetworkError = isTransientNetworkError(error);
          if (isNetworkError && attempt < MAX_ATTEMPTS - 1) {
            const delayMs = options?.suppressTransientNetworkAlert
              ? 750 * 2 ** attempt
              : 500 * 2 ** attempt;
            await new Promise(resolve => setTimeout(resolve, delayMs));
            continue;
          }
          if (isNetworkError && options?.suppressTransientNetworkAlert) return;
          Alert.alert('Unable to load tickets', error.message);
          return;
        }
      }
    },
    [filterProjectId]
  );

  useEffect(() => {
    setLoading(true);
    fetchTickets().finally(() => setLoading(false));
  }, [fetchTickets]);

  useEffect(() => {
    const supabase = getSupabase();
    let pollId: ReturnType<typeof setInterval> | null = null;
    let foregroundRefreshId: ReturnType<typeof setTimeout> | null = null;

    const stopPolling = () => {
      if (pollId) {
        clearInterval(pollId);
        pollId = null;
      }
    };

    const startPolling = () => {
      if (pollId) return;
      pollId = setInterval(() => {
        void fetchTickets({ suppressTransientNetworkAlert: true });
      }, 60_000);
    };

    const channel = supabase
      .channel('tickets-list-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tickets' },
        () => void fetchTickets({ suppressTransientNetworkAlert: true })
      )
      .subscribe(status => {
        if (status === 'SUBSCRIBED') {
          stopPolling();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          startPolling();
          void fetchTickets({ suppressTransientNetworkAlert: true });
        }
      });

    const appStateSubscription = AppState.addEventListener('change', nextAppState => {
      if (nextAppState === 'active') {
        if (foregroundRefreshId) clearTimeout(foregroundRefreshId);
        foregroundRefreshId = setTimeout(() => {
          void fetchTickets({ suppressTransientNetworkAlert: true });
        }, 1_500);
      }
    });

    return () => {
      stopPolling();
      if (foregroundRefreshId) clearTimeout(foregroundRefreshId);
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
      result.sort((a, b) => {
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
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
        viewMode={viewMode}
        viewMenuOpen={viewMenuOpen}
        showViewMenu={filterProjectId !== null}
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
          setViewMenuOpen(false);
          setProjectMenuOpen(open => !open);
        }}
        onToggleSortMenu={() => {
          setProjectMenuOpen(false);
          setStatusMenuOpen(false);
          setViewMenuOpen(false);
          setSortMenuOpen(open => !open);
        }}
        onToggleStatusMenu={() => {
          setProjectMenuOpen(false);
          setSortMenuOpen(false);
          setViewMenuOpen(false);
          setStatusMenuOpen(open => !open);
        }}
        onToggleViewMenu={() => {
          setProjectMenuOpen(false);
          setSortMenuOpen(false);
          setStatusMenuOpen(false);
          setViewMenuOpen(open => !open);
        }}
        onSelectView={mode => {
          setViewMode(mode);
          setViewMenuOpen(false);
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
        viewMode={viewMode}
        filterProject={filterProject}
        projects={projects}
        projectColor={projectColor}
        onRefresh={onRefresh}
        onCreateTicket={handleCreateTicket}
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
  const colors = useThemeColors();
  const styles = useThemedStyles(createStyles);

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
  viewMode,
  viewMenuOpen,
  showViewMenu,
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
  onToggleViewMenu,
  onSelectView,
  onSelectProject,
  onSelectSort,
  onSelectStatus
}: {
  projectName: string;
  projectColor: string;
  viewMode: ViewMode;
  viewMenuOpen: boolean;
  showViewMenu: boolean;
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
  onToggleViewMenu: () => void;
  onSelectView: (mode: ViewMode) => void;
  onSelectProject: (projectId: string | null) => void;
  onSelectSort: (mode: SortMode) => void;
  onSelectStatus: (filter: StatusFilter) => void;
}) {
  const colors = useThemeColors();
  const styles = useThemedStyles(createStyles);

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
        <View style={styles.filterChips}>
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
        {showViewMenu && (
          <View style={styles.viewMenuWrap}>
            <ViewModeMenuButton
              value={viewMode}
              open={viewMenuOpen}
              onPress={onToggleViewMenu}
              onSelect={onSelectView}
            />
          </View>
        )}
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
  viewMode,
  filterProject,
  projects,
  projectColor,
  onRefresh,
  onCreateTicket,
  onTicketPress
}: {
  loading: boolean;
  refreshing: boolean;
  tickets: TicketWithProject[];
  search: string;
  statusFilter: StatusFilter;
  viewMode: ViewMode;
  filterProject: { id: string; name: string; color: string } | null;
  projects: { id: string; name: string; color: string }[];
  projectColor: string;
  onRefresh: () => Promise<void>;
  onCreateTicket: (dueDate?: string) => void;
  onTicketPress: (ticketId: string) => void;
}) {
  const colors = useThemeColors();
  const styles = useThemedStyles(createStyles);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (viewMode === 'calendar' && filterProject) {
    return (
      <TicketsCalendarResults
        tickets={tickets}
        refreshing={refreshing}
        project={filterProject}
        projects={projects}
        projectColor={projectColor}
        onRefresh={onRefresh}
        onCreateTicket={onCreateTicket}
        onTicketPress={onTicketPress}
      />
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

function TicketsCalendarResults({
  tickets,
  refreshing,
  project,
  projects,
  projectColor,
  onRefresh,
  onCreateTicket,
  onTicketPress
}: {
  tickets: TicketWithProject[];
  refreshing: boolean;
  project: { id: string; name: string; color: string };
  projects: { id: string; name: string; color: string }[];
  projectColor: string;
  onRefresh: () => Promise<void>;
  onCreateTicket: (dueDate?: string) => void;
  onTicketPress: (ticketId: string) => void;
}) {
  const colors = useThemeColors();
  const styles = useThemedStyles(createStyles);

  const [visibleDays, setVisibleDays] = useState(() =>
    buildCalendarDays(new Date(), CALENDAR_PAST_DAYS, CALENDAR_FUTURE_DAYS)
  );

  useEffect(() => {
    setVisibleDays(buildCalendarDays(new Date(), CALENDAR_PAST_DAYS, CALENDAR_FUTURE_DAYS));
  }, [project.id]);

  const unscheduledTickets = useMemo(
    () => tickets.filter(ticket => !ticket.due_datetime),
    [tickets]
  );

  const ticketsByDate = useMemo(() => {
    const grouped = new Map<string, TicketWithProject[]>();
    for (const ticket of tickets) {
      if (!ticket.due_datetime) continue;
      const dateKey = format(parseISO(ticket.due_datetime), 'yyyy-MM-dd');
      const existing = grouped.get(dateKey) ?? [];
      existing.push(ticket);
      grouped.set(dateKey, existing);
    }
    return grouped;
  }, [tickets]);

  const loadMoreDays = useCallback(() => {
    setVisibleDays(current => {
      const lastDay = current[current.length - 1];
      if (!lastDay) return current;
      const nextStart = addDays(lastDay, 1);
      return [...current, ...buildCalendarDays(nextStart, 0, CALENDAR_PAGE_SIZE - 1)];
    });
  }, []);

  return (
    <FlatList
      data={visibleDays}
      keyExtractor={item => format(item, 'yyyy-MM-dd')}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
      }
      renderItem={({ item }) => {
        const dateKey = format(item, 'yyyy-MM-dd');
        const dayTickets = ticketsByDate.get(dateKey) ?? [];
        return (
          <CalendarDaySection
            day={item}
            dateKey={dateKey}
            tickets={dayTickets}
            project={project}
            projects={projects}
            projectColor={projectColor}
            onCreateTicket={onCreateTicket}
            onTicketPress={onTicketPress}
          />
        );
      }}
      ListHeaderComponent={
        <CalendarListHeader
          projectName={project.name}
          unscheduledTickets={unscheduledTickets}
          projects={projects}
          projectColor={projectColor}
          onTicketPress={onTicketPress}
        />
      }
      onEndReached={loadMoreDays}
      onEndReachedThreshold={0.6}
      contentContainerStyle={styles.calendarList}
    />
  );
}

function CalendarListHeader({
  projectName,
  unscheduledTickets,
  projects,
  projectColor,
  onTicketPress
}: {
  projectName: string;
  unscheduledTickets: TicketWithProject[];
  projects: { id: string; name: string; color: string }[];
  projectColor: string;
  onTicketPress: (ticketId: string) => void;
}) {
  const styles = useThemedStyles(createStyles);

  return (
    <View style={styles.calendarHeader}>
      <Text style={styles.calendarTitle}>Scheduled days</Text>
      <Text style={styles.calendarSub}>
        Add tickets directly onto the calendar for {projectName}.
      </Text>
      {unscheduledTickets.length > 0 && (
        <View style={styles.unscheduledCard}>
          <Text style={styles.unscheduledTitle}>No due date</Text>
          <Text style={styles.unscheduledSub}>
            {unscheduledTickets.length} ticket{unscheduledTickets.length === 1 ? '' : 's'} still
            need a day.
          </Text>
          <View style={styles.unscheduledList}>
            {unscheduledTickets.map(ticket => (
              <TicketCard
                key={ticket.id}
                ticket={ticket}
                projectColor={projectColor}
                projects={projects}
                onPress={() => onTicketPress(ticket.id)}
              />
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

function CalendarDaySection({
  day,
  dateKey,
  tickets,
  project,
  projects,
  projectColor,
  onCreateTicket,
  onTicketPress
}: {
  day: Date;
  dateKey: string;
  tickets: TicketWithProject[];
  project: { id: string; name: string; color: string };
  projects: { id: string; name: string; color: string }[];
  projectColor: string;
  onCreateTicket: (dueDate?: string) => void;
  onTicketPress: (ticketId: string) => void;
}) {
  const styles = useThemedStyles(createStyles);

  const today = isToday(day);

  return (
    <View style={[styles.calendarDayCard, today && styles.calendarDayCardToday]}>
      <View style={styles.calendarDayHeader}>
        <View style={styles.calendarDayHeading}>
          <Text style={styles.calendarDayWeekday}>{format(day, 'EEEE')}</Text>
          <View style={styles.calendarDayMeta}>
            <Text style={styles.calendarDayLabel}>{format(day, 'MMM d')}</Text>
            {today && <Text style={styles.calendarTodayBadge}>Today</Text>}
          </View>
        </View>
        <Pressable
          style={({ pressed }) => [
            styles.calendarAddButton,
            { borderColor: project.color || projectColor },
            pressed && styles.pressed
          ]}
          onPress={() => onCreateTicket(dateKey)}
          accessibilityLabel={`Create ticket for ${format(day, 'MMMM d')}`}
        >
          <Ionicons name="add" size={16} color={project.color || projectColor} />
        </Pressable>
      </View>
      {tickets.length > 0 ? (
        <View style={styles.calendarTickets}>
          {tickets.map(ticket => (
            <TicketCard
              key={ticket.id}
              ticket={ticket}
              projectColor={projectColor}
              projects={projects}
              onPress={() => onTicketPress(ticket.id)}
            />
          ))}
        </View>
      ) : (
        <Text style={styles.calendarEmptyText}>No tickets scheduled for this day.</Text>
      )}
    </View>
  );
}

function ViewModeMenuButton({
  value,
  open,
  onPress,
  onSelect
}: {
  value: ViewMode;
  open: boolean;
  onPress: () => void;
  onSelect: (mode: ViewMode) => void;
}) {
  const colors = useThemeColors();
  const styles = useThemedStyles(createStyles);

  return (
    <View style={styles.viewMenuWrap}>
      <Pressable
        style={({ pressed }) => [
          styles.viewMenuButton,
          open && styles.viewMenuButtonActive,
          pressed && styles.pressed
        ]}
        onPress={onPress}
        accessibilityLabel="Change ticket view"
      >
        <Ionicons
          name={value === 'calendar' ? 'calendar-outline' : 'list-outline'}
          size={16}
          color={colors.foreground}
        />
        <Ionicons name="chevron-down" size={12} color={colors.mutedForeground} />
      </Pressable>
      {open && (
        <View style={[styles.menu, styles.viewMenu]}>
          <Pressable style={styles.viewMenuItem} onPress={() => onSelect('list')}>
            <View style={styles.menuItemLeft}>
              <Ionicons
                name="list-outline"
                size={15}
                color={value === 'list' ? colors.primary : colors.mutedForeground}
              />
              <Text
                style={[styles.menuItemText, value === 'list' && styles.menuItemTextActive]}
              >
                List
              </Text>
            </View>
            {value === 'list' && <Ionicons name="checkmark" size={14} color={colors.primary} />}
          </Pressable>
          <Pressable style={styles.viewMenuItem} onPress={() => onSelect('calendar')}>
            <View style={styles.menuItemLeft}>
              <Ionicons
                name="calendar-outline"
                size={15}
                color={value === 'calendar' ? colors.primary : colors.mutedForeground}
              />
              <Text
                style={[styles.menuItemText, value === 'calendar' && styles.menuItemTextActive]}
              >
                Calendar
              </Text>
            </View>
            {value === 'calendar' && (
              <Ionicons name="checkmark" size={14} color={colors.primary} />
            )}
          </Pressable>
        </View>
      )}
    </View>
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
  const colors = useThemeColors();
  const styles = useThemedStyles(createStyles);
  const statusColors = getStatusColors(colors);
  const agentLabel = formatAgentLabel(ticket.assigned_agent);
  const ticketProject = projects.find(p => p.id === ticket.project_id) ?? null;
  const ticketProjectColor = ticketProject?.color || projectColor;
  const projectLabel = ticketProject?.name ?? 'Personal';
  const dueLabel = ticket.due_datetime ? format(parseISO(ticket.due_datetime), 'MMM d') : null;

  return (
    <Pressable style={({ pressed }) => [styles.card, pressed && styles.pressed]} onPress={onPress}>
      <View style={styles.cardTitleRow}>
        <Text style={styles.ticketTitle} numberOfLines={2}>
          {ticket.title || 'Untitled'}
        </Text>
        {ticket.has_unread && <View style={styles.unreadDot} />}
      </View>
      {dueLabel && (
        <View style={styles.cardDueRow}>
          <Ionicons name="calendar-outline" size={11} color={colors.mutedForeground} />
          <Text style={styles.cardDueText}>{dueLabel}</Text>
        </View>
      )}
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
  const colors = useThemeColors();
  const styles = useThemedStyles(createStyles);

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
  const colors = useThemeColors();
  const styles = useThemedStyles(createStyles);

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

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
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
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingBottom: 10
    },
    filterChips: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 10,
      flex: 1,
      paddingRight: 10
    },
    viewMenuWrap: {
      position: 'relative',
      flexShrink: 0
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
    viewMenuButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 1,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      flexDirection: 'row'
    },
    viewMenuButtonActive: {
      borderColor: colors.primary,
      backgroundColor: colors.secondary
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
    menuItemLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8
    },
    menuItemText: {
      color: colors.foreground,
      fontSize: 14
    },
    menuItemTextActive: {
      fontWeight: '600'
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
    calendarList: {
      paddingHorizontal: 12,
      paddingBottom: 24,
      gap: 10
    },
    viewMenu: {
      position: 'absolute',
      right: 0,
      top: 44,
      minWidth: 160,
      marginHorizontal: 0,
      marginBottom: 0,
      zIndex: 20,
      elevation: 20
    },
    viewMenuItem: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border
    },
    calendarHeader: {
      gap: 10,
      paddingBottom: 6
    },
    calendarTitle: {
      color: colors.foreground,
      fontSize: 18,
      fontWeight: '700'
    },
    calendarSub: {
      color: colors.mutedForeground,
      fontSize: 13,
      lineHeight: 18
    },
    unscheduledCard: {
      backgroundColor: colors.card,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 12,
      gap: 8
    },
    unscheduledTitle: {
      color: colors.foreground,
      fontSize: 14,
      fontWeight: '700'
    },
    unscheduledSub: {
      color: colors.mutedForeground,
      fontSize: 12
    },
    unscheduledList: {
      gap: 8
    },
    calendarDayCard: {
      backgroundColor: colors.card,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 12,
      gap: 10
    },
    calendarDayCardToday: {
      borderColor: colors.primary
    },
    calendarDayHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12
    },
    calendarDayHeading: {
      flex: 1,
      gap: 4
    },
    calendarDayWeekday: {
      color: colors.foreground,
      fontSize: 16,
      fontWeight: '700'
    },
    calendarDayMeta: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8
    },
    calendarDayLabel: {
      color: colors.mutedForeground,
      fontSize: 13
    },
    calendarTodayBadge: {
      color: colors.primary,
      fontSize: 12,
      fontWeight: '700'
    },
    calendarAddButton: {
      width: 34,
      height: 34,
      borderRadius: 17,
      borderWidth: 1,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.background
    },
    calendarTickets: {
      gap: 8
    },
    calendarEmptyText: {
      color: colors.mutedForeground,
      fontSize: 13
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
    cardDueRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      marginBottom: 8
    },
    cardDueText: {
      color: colors.mutedForeground,
      fontSize: 12
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
