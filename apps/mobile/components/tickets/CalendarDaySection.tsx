import { format, isToday } from 'date-fns';
import { Pressable, Text, View } from 'react-native';

import { useThemedStyles } from '@/lib/colors';
import { Ionicons } from '@/lib/icons';

import type { TicketWithProject } from './shared';
import { TicketCard } from './TicketCard';
import { createTicketsScreenStyles } from './TicketsScreenStyles';

type CalendarDaySectionProps = {
  day: Date;
  dateKey: string;
  tickets: TicketWithProject[];
  project: { id: string; name: string; color: string };
  projects: { id: string; name: string; color: string }[];
  projectColor: string;
  onCreateTicket: (dueDate?: string) => void;
  onTicketPress: (ticketId: string) => void;
};

export function CalendarDaySection({
  day,
  dateKey,
  tickets,
  project,
  projects,
  projectColor,
  onCreateTicket,
  onTicketPress
}: CalendarDaySectionProps) {
  const styles = useThemedStyles(createTicketsScreenStyles);

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
