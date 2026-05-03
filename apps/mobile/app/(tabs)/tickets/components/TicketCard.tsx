import { Ionicons } from '@expo/vector-icons';
import { format, parseISO } from 'date-fns';
import { Pressable, Text, View } from 'react-native';

import { useThemeColors, useThemedStyles } from '@/lib/colors';

import { formatAgentLabel, getTicketDisplayTitle, type TicketWithProject } from './shared';
import { createTicketsScreenStyles } from './TicketsScreenStyles';

type TicketCardProps = {
  ticket: TicketWithProject;
  projectColor: string;
  projects: { id: string; name: string; color: string }[];
  showProjectName?: boolean;
  onPress: () => void;
};

const executionIconColors = ({ isDark }: { isDark: boolean }) =>
  ({
    agent: isDark ? '#34d399' : '#059669',
    human: isDark ? '#fbbf24' : '#b45309'
  }) as const;

export function TicketCard({
  ticket,
  projectColor,
  projects,
  showProjectName = false,
  onPress
}: TicketCardProps) {
  const colors = useThemeColors();
  const styles = useThemedStyles(createTicketsScreenStyles);
  const agentLabel = formatAgentLabel(ticket.assigned_agent);
  const ticketProject = projects.find(p => p.id === ticket.project_id) ?? null;
  const ticketProjectColor = ticketProject?.color || projectColor;
  const projectLabel = ticketProject?.name ?? 'Personal';
  const dueLabel = ticket.due_datetime ? format(parseISO(ticket.due_datetime), 'MMM d') : null;
  const execColors = executionIconColors({ isDark: colors.isDark });
  const executionColor = ticket.execution_target === 'agent' ? execColors.agent : execColors.human;
  const showProjectHint = showProjectName && projectLabel.length > 0 && projectLabel !== 'Personal';

  return (
    <Pressable
      style={({ pressed }) => [
        styles.ticketListRow,
        ticket.has_unread && styles.ticketListRowUnread,
        pressed && styles.pressed
      ]}
      onPress={onPress}
    >
      <View style={[styles.ticketListProjectDot, { backgroundColor: ticketProjectColor }]} />
      <View style={styles.ticketListMain}>
        <Text style={styles.ticketListTitle} numberOfLines={1}>
          {getTicketDisplayTitle(ticket)}
        </Text>
        {(dueLabel || agentLabel) && (
          <View style={styles.ticketListSubrows}>
            {dueLabel ? (
              <View style={styles.ticketListDue}>
                <Ionicons name="calendar-outline" size={10} color={colors.mutedForeground} />
                <Text style={styles.ticketListDueText}>{dueLabel}</Text>
              </View>
            ) : null}
            {agentLabel ? (
              <View style={styles.ticketListAgentRow}>
                <Ionicons
                  name={
                    ticket.execution_target === 'agent' ? 'hardware-chip-outline' : 'person-outline'
                  }
                  size={10}
                  color={ticket.execution_target === 'agent' ? '#ea580c' : colors.mutedForeground}
                />
                <Text
                  style={[
                    styles.ticketListAgentText,
                    {
                      color:
                        ticket.execution_target === 'agent' ? '#ea580c' : colors.mutedForeground
                    }
                  ]}
                  numberOfLines={1}
                >
                  {agentLabel}
                </Text>
              </View>
            ) : null}
          </View>
        )}
      </View>
      <View style={styles.ticketListRight}>
        {showProjectHint ? (
          <Text style={styles.ticketListProjectHint} numberOfLines={1}>
            {projectLabel}
          </Text>
        ) : null}
        <View style={styles.ticketListExecWrap}>
          <Ionicons
            name={ticket.execution_target === 'agent' ? 'hardware-chip-outline' : 'person-outline'}
            size={14}
            color={executionColor}
          />
        </View>
        {ticket.has_unread ? <View style={styles.unreadDot} /> : null}
      </View>
    </Pressable>
  );
}
