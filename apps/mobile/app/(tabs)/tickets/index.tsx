import { GlassView } from 'expo-glass-effect';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState, Keyboard, Pressable, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { QuickCreateTicketModal } from '@/components/QuickCreateTicketModal';
import { SidebarDrawer } from '@/components/SidebarDrawer';
import { useGlassAvailable, useThemeColors, useThemedStyles } from '@/lib/colors';
import { Ionicons } from '@/lib/icons';
import { useSelectedProject } from '@/lib/selected-project-context';
import { getSupabase } from '@/lib/supabase';
import { isTransientNetworkError } from '@/lib/transient-network-error';

import {
  ALL_PROJECTS_LABEL,
  buildStatusFilterOptions,
  formatStatusName,
  getContrastColor,
  matchesStatusFilter,
  resolvePreferredStatusNameByType,
  type SortMode,
  type StatusFilter,
  type TagFilterOption,
  type TicketStatusDefinition,
  type TicketTagSummary,
  type TicketWithProject,
  type ViewMode
} from './components/shared';
import { TicketsResults } from './components/TicketsResults';
import { TicketsScreenFilters } from './components/TicketsScreenFilters';
import { createTicketsScreenStyles } from './components/TicketsScreenStyles';
import {
  normalizeTicketExecutionTarget,
  type TicketListItemRow
} from '@/lib/types';

const TICKETS_FILTER_PREFERENCES_KEY = 'mobile-ticket-screen-filters';

type TicketFilterPreferences = {
  sortMode: SortMode;
  statusFilter: StatusFilter;
  viewMode: ViewMode;
  selectedTagIds: string[];
};

function parseTicketFilterPreferences(raw: string | null): TicketFilterPreferences | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      sortMode:
        parsed.sortMode === 'created' || parsed.sortMode === 'priority'
          ? parsed.sortMode
          : 'updated',
      statusFilter: Array.isArray(parsed.statusFilter)
        ? parsed.statusFilter.filter((value): value is string => typeof value === 'string')
        : [],
      viewMode: parsed.viewMode === 'calendar' ? 'calendar' : 'list',
      selectedTagIds: Array.isArray(parsed.selectedTagIds)
        ? parsed.selectedTagIds.filter((value): value is string => typeof value === 'string')
        : []
    };
  } catch {
    return null;
  }
}

function loadTicketFilterPreferences(): TicketFilterPreferences | null {
  try {
    return parseTicketFilterPreferences(SecureStore.getItem(TICKETS_FILTER_PREFERENCES_KEY));
  } catch {
    return null;
  }
}

function saveTicketFilterPreferences(preferences: TicketFilterPreferences) {
  void SecureStore.setItemAsync(TICKETS_FILTER_PREFERENCES_KEY, JSON.stringify(preferences), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY
  }).catch(() => undefined);
}

function buildTagOptions(tickets: TicketWithProject[]): TagFilterOption[] {
  const byId = new Map<string, TicketTagSummary>();
  for (const ticket of tickets) {
    for (const tag of ticket.tags ?? []) {
      if (!byId.has(tag.id)) {
        byId.set(tag.id, tag);
      }
    }
  }
  return [...byId.values()].sort((left, right) => left.label.localeCompare(right.label));
}

export default function TicketsScreen() {
  const router = useRouter();
  const { projects, selectedProjectId, selectProject } = useSelectedProject();
  const searchInputRef = useRef<TextInput | null>(null);
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const { projectId: projectIdParam } = useLocalSearchParams<{ projectId?: string }>();
  const colors = useThemeColors();
  const styles = useThemedStyles(createTicketsScreenStyles);
  const glassAvailable = useGlassAvailable();
  const [storedPreferences] = useState<TicketFilterPreferences | null>(() =>
    loadTicketFilterPreferences()
  );

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
  const [sortMode, setSortMode] = useState<SortMode>(storedPreferences?.sortMode ?? 'updated');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(
    storedPreferences?.statusFilter ?? []
  );
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>(
    storedPreferences?.selectedTagIds ?? []
  );
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const [tagMenuOpen, setTagMenuOpen] = useState(false);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>(storedPreferences?.viewMode ?? 'list');
  const [collapsedStatuses, setCollapsedStatuses] = useState<Set<string>>(new Set());
  const [statusDefinitions, setStatusDefinitions] = useState<TicketStatusDefinition[]>([]);

  const toggleCollapsed = useCallback((statusName: string) => {
    setCollapsedStatuses(prev => {
      const next = new Set(prev);
      if (next.has(statusName)) next.delete(statusName);
      else next.add(statusName);
      return next;
    });
  }, []);

  const handleCreateTicket = useCallback((_dueDate?: string) => {
    searchInputRef.current?.blur();
    Keyboard.dismiss();
    setTimeout(() => {
      setCreateModalVisible(true);
    }, 150);
  }, []);

  const fetchTickets = useCallback(
    async (options?: { suppressTransientNetworkAlert?: boolean }) => {
      const supabase = getSupabase();

      const runQuery = () => {
        let q = supabase
          .from('tickets')
          .select(
            'id, organization_id, title, status, priority, for_human, ticket_sequence, due_datetime, created_at, updated_at, project_id, board_position'
          )
          .order('updated_at', { ascending: false })
          .limit(100);
        if (filterProjectId) q = q.eq('project_id', filterProjectId);
        return q;
      };

      const MAX_ATTEMPTS = options?.suppressTransientNetworkAlert ? 4 : 3;
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const [
          { data, error },
          { data: execObjectives },
          { data: assignedObjectives },
          { data: statusRows, error: statusError }
        ] = await Promise.all([
          runQuery(),
          supabase.from('objectives').select('ticket_id').eq('state', 'executing'),
          supabase
            .from('objectives')
            .select('ticket_id,assigned_agent')
            .order('created_at', { ascending: false }),
          supabase
            .from('ticket_statuses')
            .select('organization_id,name,position,status_type')
            .order('position', { ascending: true })
        ]);
        if (!error && data) {
          if (statusError) {
            Alert.alert('Unable to load ticket statuses', statusError.message);
            return;
          }
          const executingTicketIds = new Set((execObjectives ?? []).map(o => o.ticket_id));
          const assignedByTicket = new Map<string, unknown>();
          for (const objective of assignedObjectives ?? []) {
            if (!assignedByTicket.has(objective.ticket_id)) {
              assignedByTicket.set(objective.ticket_id, objective.assigned_agent);
            }
          }
          const ticketIds = (data ?? []).map(ticket => ticket.id);
          const tagMap = new Map<string, Map<string, TicketTagSummary>>();
          if (ticketIds.length > 0) {
            const { data: tagRows, error: tagError } = await supabase
              .from('ticket_tag_assignments')
              .select(
                'ticket_id, tag_definition_id, project_tag_definitions(label,color,is_active)'
              )
              .in('ticket_id', ticketIds);

            if (tagError) {
              Alert.alert('Unable to load ticket tags', tagError.message);
              return;
            }

            for (const row of tagRows ?? []) {
              const definition = (
                row as unknown as {
                  project_tag_definitions:
                    | Array<{ label: string; color: string | null; is_active: boolean }>
                    | { label: string; color: string | null; is_active: boolean }
                    | null;
                }
              ).project_tag_definitions;
              const tagDefinition = Array.isArray(definition) ? definition[0] : definition;
              if (!tagDefinition?.is_active) continue;
              if (!tagMap.has(row.ticket_id)) {
                tagMap.set(row.ticket_id, new Map());
              }
              tagMap.get(row.ticket_id)!.set(row.tag_definition_id, {
                id: row.tag_definition_id,
                label: tagDefinition.label,
                color: tagDefinition.color
              });
            }
          }
          setStatusDefinitions((statusRows ?? []) as TicketStatusDefinition[]);
          setTickets(
            (data as TicketListItemRow[]).map(t => ({
              ...normalizeTicketExecutionTarget(t),
              assigned_agent: assignedByTicket.get(t.id) ?? null,
              has_executing_objective: executingTicketIds.has(t.id),
              tags: [...(tagMap.get(t.id)?.values() ?? [])].sort((a, b) =>
                a.label.localeCompare(b.label)
              )
            })) as TicketWithProject[]
          );
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
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'objectives' },
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

    if (statusFilter.length > 0) {
      result = result.filter(ticket => matchesStatusFilter(ticket, statusFilter));
    }

    if (search.trim()) {
      const needle = search.trim().toLowerCase();
      result = result.filter(ticket => {
        const title = (ticket.title ?? '').toLowerCase();
        return title.includes(needle) || String(ticket.ticket_sequence).includes(needle);
      });
    }

    if (selectedTagIds.length > 0) {
      result = result.filter(ticket =>
        (ticket.tags ?? []).some(tag => selectedTagIds.includes(tag.id))
      );
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
  }, [tickets, statusFilter, search, selectedTagIds, sortMode]);
  const tagOptions = useMemo(() => buildTagOptions(tickets), [tickets]);

  const statusFilterOptions = useMemo(
    () => buildStatusFilterOptions(statusDefinitions, tickets),
    [statusDefinitions, tickets]
  );
  const allStatusesSelected =
    statusFilter.length === 0 || statusFilter.length === statusFilterOptions.length;
  const statusFilterLabel = useMemo(() => {
    if (statusFilter.length === 0 || statusFilterOptions.length === 0 || allStatusesSelected) {
      return 'All statuses';
    }
    if (statusFilter.length === 1) {
      return formatStatusName(statusFilter[0] ?? '');
    }
    if (statusFilter.length <= 2) {
      return statusFilter.map(formatStatusName).join(', ');
    }
    return `${statusFilter.length} statuses`;
  }, [allStatusesSelected, statusFilter, statusFilterOptions.length]);

  useEffect(() => {
    if (statusFilter.length === 0) return;

    const available = new Set(statusFilterOptions);
    setStatusFilter(current => {
      if (current.length === 0) return current;
      const next = current.filter(status => available.has(status));
      if (next.length === current.length) return current;
      return next.length > 0 ? next : [];
    });
  }, [statusFilter.length, statusFilterOptions]);

  useEffect(() => {
    saveTicketFilterPreferences({
      sortMode,
      statusFilter,
      viewMode,
      selectedTagIds
    });
  }, [selectedTagIds, sortMode, statusFilter, viewMode]);

  useEffect(() => {
    if (selectedTagIds.length === 0) return;
    const validIds = new Set(tagOptions.map(tag => tag.id));
    setSelectedTagIds(current => {
      const next = current.filter(id => validIds.has(id));
      return next.length === current.length ? current : next;
    });
  }, [selectedTagIds.length, tagOptions]);

  const persistReorder = useCallback(
    async (
      orderedIdsByStatus: Map<string, string[]>,
      statusChange: { ticketId: string; newStatus: string } | null
    ) => {
      const supabase = getSupabase();
      const updates: PromiseLike<{ error: { message: string } | null }>[] = [];

      for (const [, orderedIds] of orderedIdsByStatus) {
        orderedIds.forEach((id, index) => {
          updates.push(supabase.from('tickets').update({ board_position: index }).eq('id', id));
        });
      }

      if (statusChange) {
        updates.push(
          supabase
            .from('tickets')
            .update({ status: statusChange.newStatus })
            .eq('id', statusChange.ticketId)
        );
      }

      const results = await Promise.all(updates);
      for (const result of results) {
        if (result.error) {
          Alert.alert('Unable to reorder tickets', result.error.message);
          void fetchTickets({ suppressTransientNetworkAlert: true });
          return;
        }
      }
    },
    [fetchTickets]
  );

  const handleSectionedReorder = useCallback(
    (nextSectioned: Map<string, TicketWithProject[]>) => {
      setTickets(prev => {
        const map = new Map(prev.map(t => [t.id, t]));
        for (const [statusName, sectionTickets] of nextSectioned) {
          sectionTickets.forEach((t, index) => {
            const existing = map.get(t.id);
            if (existing) {
              map.set(t.id, { ...existing, status: statusName, board_position: index });
            }
          });
        }
        return [...map.values()];
      });

      const orderedIdsByStatus = new Map<string, string[]>();
      let statusChange: { ticketId: string; newStatus: string } | null = null;

      for (const [statusName, sectionTickets] of nextSectioned) {
        orderedIdsByStatus.set(
          statusName,
          sectionTickets.map(t => t.id)
        );
        for (const t of sectionTickets) {
          const current = tickets.find(existing => existing.id === t.id);
          if (current && current.status !== statusName) {
            statusChange = { ticketId: t.id, newStatus: statusName };
          }
        }
      }

      void persistReorder(orderedIdsByStatus, statusChange);
    },
    [persistReorder, tickets]
  );

  const handleCompleteTicket = useCallback(
    async (ticketId: string) => {
      const previousTicket = tickets.find(ticket => ticket.id === ticketId);
      if (!previousTicket) {
        return;
      }

      const completeStatusName = resolvePreferredStatusNameByType(
        statusDefinitions,
        previousTicket.organization_id,
        'complete'
      );
      if (!completeStatusName || previousTicket.status === completeStatusName) return;

      setTickets(prev =>
        prev.map(ticket =>
          ticket.id === ticketId
            ? { ...ticket, status: completeStatusName, board_position: 0 }
            : ticket
        )
      );

      const supabase = getSupabase();
      const { error } = await supabase
        .from('tickets')
        .update({ status: completeStatusName })
        .eq('id', ticketId);

      if (error) {
        setTickets(prev => prev.map(ticket => (ticket.id === ticketId ? previousTicket : ticket)));
        Alert.alert('Unable to complete ticket', error.message);
        return;
      }

      void fetchTickets({ suppressTransientNetworkAlert: true });
    },
    [fetchTickets, statusDefinitions, tickets]
  );

  const filterProject = useMemo(
    () => projects.find(p => p.id === filterProjectId) ?? null,
    [projects, filterProjectId]
  );
  const projectColor = filterProject?.color || colors.primary;
  const projectName = filterProject?.name ?? ALL_PROJECTS_LABEL;
  const buttonIconColor = getContrastColor(projectColor);

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <Stack.Screen
        options={{
          headerTransparent: true,
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.foreground,
          headerTitle: () => {
            return glassAvailable ? (
              <GlassView style={styles.searchWrap} glassEffectStyle="regular">
                <Ionicons name="search" size={14} color={colors.mutedForeground} />
                <TextInput
                  ref={searchInputRef}
                  value={search}
                  onChangeText={setSearch}
                  placeholder="Search ticket"
                  placeholderTextColor={colors.mutedForeground}
                  style={styles.searchInput}
                />
              </GlassView>
            ) : (
              <View style={[styles.searchWrap, styles.searchWrapFallback]}>
                <Ionicons name="search" size={14} color={colors.mutedForeground} />
                <TextInput
                  ref={searchInputRef}
                  value={search}
                  onChangeText={setSearch}
                  placeholder="Search ticket"
                  placeholderTextColor={colors.mutedForeground}
                  style={styles.searchInput}
                />
              </View>
            );
          }
        }}
      >
        <Stack.Toolbar placement="left">
          <Stack.Toolbar.View hidesSharedBackground>
            <Pressable
              hitSlop={10}
              style={styles.ghostButton}
              onPress={() => setDrawerOpen(true)}
              accessibilityLabel="Open navigation"
            >
              <Ionicons name="menu-outline" size={22} color={colors.foreground} />
            </Pressable>
          </Stack.Toolbar.View>
        </Stack.Toolbar>

        <Stack.Toolbar placement="right">
          <Stack.Toolbar.View hidesSharedBackground>
            <Pressable
              hitSlop={10}
              onPress={() => handleCreateTicket()}
              style={[styles.createButton, { backgroundColor: projectColor }]}
              accessibilityLabel="Create ticket"
            >
              <Ionicons name="add" size={16} color={buttonIconColor} />
              <Ionicons name="ticket-outline" size={14} color={buttonIconColor} />
            </Pressable>
          </Stack.Toolbar.View>
        </Stack.Toolbar>
      </Stack.Screen>
      <TicketsScreenFilters
        projectName={projectName}
        projectColor={projectColor}
        viewMode={viewMode}
        viewMenuOpen={viewMenuOpen}
        showViewMenu={true}
        projectMenuOpen={projectMenuOpen}
        sortMenuOpen={sortMenuOpen}
        statusMenuOpen={statusMenuOpen}
        tagMenuOpen={tagMenuOpen}
        sortMode={sortMode}
        statusFilter={statusFilter}
        statusFilterLabel={statusFilterLabel}
        statusFilterOptions={statusFilterOptions}
        selectedTagIds={selectedTagIds}
        tagOptions={tagOptions}
        projects={projects}
        filterProjectId={filterProjectId}
        allStatusesSelected={allStatusesSelected}
        onToggleProjectMenu={() => {
          setSortMenuOpen(false);
          setStatusMenuOpen(false);
          setTagMenuOpen(false);
          setViewMenuOpen(false);
          setProjectMenuOpen(open => !open);
        }}
        onToggleSortMenu={() => {
          setProjectMenuOpen(false);
          setStatusMenuOpen(false);
          setTagMenuOpen(false);
          setViewMenuOpen(false);
          setSortMenuOpen(open => !open);
        }}
        onToggleStatusMenu={() => {
          setProjectMenuOpen(false);
          setSortMenuOpen(false);
          setTagMenuOpen(false);
          setViewMenuOpen(false);
          setStatusMenuOpen(open => !open);
        }}
        onToggleTagMenu={() => {
          setProjectMenuOpen(false);
          setSortMenuOpen(false);
          setStatusMenuOpen(false);
          setViewMenuOpen(false);
          setTagMenuOpen(open => !open);
        }}
        onToggleViewMenu={() => {
          setProjectMenuOpen(false);
          setSortMenuOpen(false);
          setStatusMenuOpen(false);
          setTagMenuOpen(false);
          setViewMenuOpen(open => !open);
        }}
        onSelectView={mode => {
          setViewMode(mode);
          setViewMenuOpen(false);
        }}
        onSelectProject={projectId => selectProject(projectId)}
        onSelectSort={mode => setSortMode(mode)}
        onSelectStatus={status => {
          setStatusFilter(current => {
            const currentlyAllSelected =
              current.length === 0 || current.length === statusFilterOptions.length;
            if (currentlyAllSelected) {
              return [status];
            }

            if (current.includes(status)) {
              const next = current.filter(currentStatus => currentStatus !== status);
              return next.length > 0 ? next : [];
            }

            return [...current, status];
          });
        }}
        onSelectAllStatuses={() => setStatusFilter([])}
        onSelectTag={tagId => {
          setSelectedTagIds(current =>
            current.includes(tagId)
              ? current.filter(currentTagId => currentTagId !== tagId)
              : [...current, tagId]
          );
        }}
        onSelectAllTags={() => setSelectedTagIds([])}
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
        statusDefinitions={statusDefinitions}
        projectColor={projectColor}
        collapsedStatuses={collapsedStatuses}
        onToggleCollapsed={toggleCollapsed}
        onSectionedReorder={handleSectionedReorder}
        onCompleteTicket={handleCompleteTicket}
        onRefresh={onRefresh}
        onCreateTicket={handleCreateTicket}
        onTicketPress={ticketId => router.push(`/(tabs)/tickets/${ticketId}`)}
      />
      <SidebarDrawer visible={drawerOpen} onClose={() => setDrawerOpen(false)} />
      <QuickCreateTicketModal
        visible={createModalVisible}
        onClose={() => setCreateModalVisible(false)}
        defaultProjectId={filterProjectId}
      />
    </SafeAreaView>
  );
}
