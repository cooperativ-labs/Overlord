import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '@/lib/colors';
import type { ExecutingFeedTicket } from '@/lib/types';

const AGENT_LABELS: Record<string, string> = {
  'claude-code': 'Claude Code',
  claude: 'Claude Code',
  codex: 'Codex',
  cursor: 'Cursor',
  gemini: 'Gemini',
  'google-gemini': 'Gemini',
  opencode: 'OpenCode',
  'open-code': 'OpenCode'
};

function getAgentLabel(identifier: string): string {
  return AGENT_LABELS[identifier.trim().toLowerCase()] ?? identifier;
}

type Props = {
  tickets: ExecutingFeedTicket[];
};

export function ExecutingTicketsSection({ tickets }: Props) {
  const router = useRouter();

  if (tickets.length === 0) return null;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Ionicons name="pulse-outline" size={16} color="#10b981" />
        <Text style={styles.headerText}>In execution</Text>
      </View>

      {tickets.map(ticket => (
        <Pressable
          key={ticket.id}
          style={styles.card}
          onPress={() =>
            router.push({
              pathname: '/(tabs)/tickets/[ticketId]',
              params: { ticketId: ticket.id }
            })
          }
          accessibilityRole="button"
          accessibilityLabel={`Open ticket ${ticket.ticket_sequence ? `#${ticket.ticket_sequence} ` : ''}${ticket.title ?? 'Untitled ticket'}`}
        >
          <View style={styles.projectRow}>
            <View style={[styles.projectDot, { backgroundColor: ticket.project_color }]} />
            <Text style={styles.projectName} numberOfLines={1}>
              {ticket.project_name}
            </Text>
          </View>

          <Text style={styles.ticketTitle} numberOfLines={2}>
            {ticket.ticket_sequence ? `#${ticket.ticket_sequence} ` : ''}
            {ticket.title ?? 'Untitled ticket'}
          </Text>

          <View style={styles.agentRow}>
            <Ionicons name="hardware-chip-outline" size={12} color={colors.mutedForeground} />
            <Text style={styles.agentText}>{getAgentLabel(ticket.running_agent)}</Text>
          </View>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 4
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12
  },
  headerText: {
    color: colors.foreground,
    fontSize: 14,
    fontWeight: '600'
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.2)'
  },
  projectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6
  },
  projectDot: {
    width: 8,
    height: 8,
    borderRadius: 4
  },
  projectName: {
    color: colors.mutedForeground,
    fontSize: 12,
    flex: 1
  },
  ticketTitle: {
    color: colors.foreground,
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 20,
    marginBottom: 6
  },
  agentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4
  },
  agentText: {
    color: colors.mutedForeground,
    fontSize: 12
  }
});
