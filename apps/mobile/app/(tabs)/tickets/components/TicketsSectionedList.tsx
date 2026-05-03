import { useCallback, useMemo } from 'react';
import { Pressable, RefreshControl, ScrollView } from 'react-native';
import DraggableFlatList, {
  type RenderItemParams,
  ScaleDecorator
} from 'react-native-draggable-flatlist';

import { useThemeColors, useThemedStyles } from '@/lib/colors';

import { SectionHeader } from './SectionHeader';
import {
  buildOrderedSections,
  type SectionItem,
  type StatusFilter,
  type TicketWithProject
} from './shared';
import { TicketCard } from './TicketCard';
import { TicketsEmptyState } from './TicketsEmptyState';
import { createTicketsScreenStyles } from './TicketsScreenStyles';

type TicketsSectionedListProps = {
  tickets: TicketWithProject[];
  search: string;
  statusFilter: StatusFilter;
  filterProject: { id: string; name: string; color: string } | null;
  projects: { id: string; name: string; color: string }[];
  projectColor: string;
  collapsedStatuses: Set<string>;
  refreshing: boolean;
  onRefresh: () => Promise<void>;
  onTicketPress: (ticketId: string) => void;
  onToggleCollapsed: (statusName: string) => void;
  onSectionedReorder: (nextSectioned: Map<string, TicketWithProject[]>) => void;
};

export function TicketsSectionedList({
  tickets,
  search,
  statusFilter,
  filterProject,
  projects,
  projectColor,
  collapsedStatuses,
  refreshing,
  onRefresh,
  onTicketPress,
  onToggleCollapsed,
  onSectionedReorder
}: TicketsSectionedListProps) {
  const colors = useThemeColors();
  const styles = useThemedStyles(createTicketsScreenStyles);

  const sections = useMemo(
    () => buildOrderedSections(tickets, statusFilter),
    [tickets, statusFilter]
  );

  const flattened = useMemo<SectionItem[]>(() => {
    const items: SectionItem[] = [];
    for (const section of sections) {
      const collapsed = collapsedStatuses.has(section.status);
      items.push({
        kind: 'header',
        status: section.status,
        count: section.tickets.length,
        collapsed
      });
      if (!collapsed) {
        for (const ticket of section.tickets) {
          items.push({ kind: 'ticket', ticket });
        }
      }
    }
    return items;
  }, [sections, collapsedStatuses]);

  const keyExtractor = useCallback((item: SectionItem) => {
    return item.kind === 'header' ? `header:${item.status}` : `ticket:${item.ticket.id}`;
  }, []);

  const handleDragEnd = useCallback(
    ({ data }: { data: SectionItem[] }) => {
      const next = new Map<string, TicketWithProject[]>();

      for (const section of sections) {
        next.set(section.status, collapsedStatuses.has(section.status) ? [...section.tickets] : []);
      }

      let currentStatus: string | null = null;
      for (const item of data) {
        if (item.kind === 'header') {
          currentStatus = item.status;
          if (!next.has(currentStatus)) next.set(currentStatus, []);
          continue;
        }
        if (!currentStatus) {
          const fallback = item.ticket.status;
          const list = next.get(fallback) ?? [];
          list.push(item.ticket);
          next.set(fallback, list);
          continue;
        }
        const list = next.get(currentStatus) ?? [];
        list.push(item.ticket);
        next.set(currentStatus, list);
      }

      onSectionedReorder(next);
    },
    [sections, collapsedStatuses, onSectionedReorder]
  );

  const renderItem = useCallback(
    ({ item, drag, isActive }: RenderItemParams<SectionItem>) => {
      if (item.kind === 'header') {
        return (
          <SectionHeader
            status={item.status}
            count={item.count}
            collapsed={item.collapsed}
            onToggle={() => onToggleCollapsed(item.status)}
          />
        );
      }
      return (
        <ScaleDecorator>
          <Pressable
            onPress={() => onTicketPress(item.ticket.id)}
            onLongPress={drag}
            disabled={isActive}
            delayLongPress={180}
          >
            <TicketCard
              ticket={item.ticket}
              projectColor={projectColor}
              projects={projects}
              showProjectName={filterProject === null}
              onPress={() => onTicketPress(item.ticket.id)}
            />
          </Pressable>
        </ScaleDecorator>
      );
    },
    [filterProject, projectColor, projects, onToggleCollapsed, onTicketPress]
  );

  if (tickets.length === 0) {
    return (
      <ScrollView
        contentContainerStyle={styles.emptyContainer}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
          />
        }
      >
        <TicketsEmptyState
          search={search}
          statusFilter={statusFilter}
          filterProject={filterProject}
        />
      </ScrollView>
    );
  }

  return (
    <DraggableFlatList<SectionItem>
      data={flattened}
      keyExtractor={keyExtractor}
      onDragEnd={handleDragEnd}
      renderItem={renderItem}
      activationDistance={12}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
      }
      contentContainerStyle={styles.list}
    />
  );
}
