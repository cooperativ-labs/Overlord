import { ActivityIndicator, View } from 'react-native';

import { useThemeColors, useThemedStyles } from '@/lib/colors';

import type { StatusFilter, TicketStatusDefinition, TicketWithProject, ViewMode } from './shared';
import { TicketsCalendarResults } from './TicketsCalendarResults';
import { createTicketsScreenStyles } from './TicketsScreenStyles';
import { TicketsSectionedList } from './TicketsSectionedList';

type TicketsResultsProps = {
  loading: boolean;
  refreshing: boolean;
  tickets: TicketWithProject[];
  search: string;
  statusFilter: StatusFilter;
  viewMode: ViewMode;
  filterProject: { id: string; name: string; color: string } | null;
  projects: { id: string; name: string; color: string }[];
  statusDefinitions: TicketStatusDefinition[];
  projectColor: string;
  collapsedStatuses: Set<string>;
  onToggleCollapsed: (statusName: string) => void;
  onSectionedReorder: (nextSectioned: Map<string, TicketWithProject[]>) => void;
  onCompleteTicket: (ticketId: string) => void;
  onRefresh: () => Promise<void>;
  onCreateTicket: (dueDate?: string) => void;
  onTicketPress: (ticketId: string) => void;
};

export function TicketsResults({
  loading,
  refreshing,
  tickets,
  search,
  statusFilter,
  viewMode,
  filterProject,
  projects,
  statusDefinitions,
  projectColor,
  collapsedStatuses,
  onToggleCollapsed,
  onSectionedReorder,
  onCompleteTicket,
  onRefresh,
  onCreateTicket,
  onTicketPress
}: TicketsResultsProps) {
  const colors = useThemeColors();
  const styles = useThemedStyles(createTicketsScreenStyles);
  const calendarProject = filterProject ?? {
    id: 'all-tickets',
    name: 'My Tickets',
    color: projectColor
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (viewMode === 'calendar') {
    return (
      <TicketsCalendarResults
        tickets={tickets}
        refreshing={refreshing}
        project={calendarProject}
        projects={projects}
        projectColor={projectColor}
        onRefresh={onRefresh}
        onCreateTicket={onCreateTicket}
        onTicketPress={onTicketPress}
      />
    );
  }

  return (
    <TicketsSectionedList
      tickets={tickets}
      search={search}
      statusFilter={statusFilter}
      filterProject={filterProject}
      projects={projects}
      statusDefinitions={statusDefinitions}
      projectColor={projectColor}
      collapsedStatuses={collapsedStatuses}
      refreshing={refreshing}
      onRefresh={onRefresh}
      onTicketPress={onTicketPress}
      onCompleteTicket={onCompleteTicket}
      onToggleCollapsed={onToggleCollapsed}
      onSectionedReorder={onSectionedReorder}
    />
  );
}
