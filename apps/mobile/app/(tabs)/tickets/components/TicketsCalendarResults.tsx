import { addDays, format, parseISO } from 'date-fns';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, RefreshControl } from 'react-native';

import { useThemeColors, useThemedStyles } from '@/lib/colors';

import { CalendarDaySection } from './CalendarDaySection';
import { CalendarListHeader } from './CalendarListHeader';
import {
  buildCalendarDays,
  CALENDAR_FUTURE_DAYS,
  CALENDAR_PAGE_SIZE,
  CALENDAR_PAST_DAYS,
  type TicketWithProject
} from './shared';
import { createTicketsScreenStyles } from './TicketsScreenStyles';

type TicketsCalendarResultsProps = {
  tickets: TicketWithProject[];
  refreshing: boolean;
  project: { id: string; name: string; color: string };
  projects: { id: string; name: string; color: string }[];
  projectColor: string;
  onRefresh: () => Promise<void>;
  onCreateTicket: (dueDate?: string) => void;
  onTicketPress: (ticketId: string) => void;
};

export function TicketsCalendarResults({
  tickets,
  refreshing,
  project,
  projects,
  projectColor,
  onRefresh,
  onCreateTicket,
  onTicketPress
}: TicketsCalendarResultsProps) {
  const colors = useThemeColors();
  const styles = useThemedStyles(createTicketsScreenStyles);

  const [visibleDays, setVisibleDays] = useState(() =>
    buildCalendarDays(new Date(), CALENDAR_PAST_DAYS, CALENDAR_FUTURE_DAYS)
  );

  useEffect(() => {
    setVisibleDays(buildCalendarDays(new Date(), CALENDAR_PAST_DAYS, CALENDAR_FUTURE_DAYS));
  }, [project.id]);

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
      ListHeaderComponent={<CalendarListHeader projectName={project.name} />}
      onEndReached={loadMoreDays}
      onEndReachedThreshold={0.6}
      contentContainerStyle={styles.calendarList}
    />
  );
}
