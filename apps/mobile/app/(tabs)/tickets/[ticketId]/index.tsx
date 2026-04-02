import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from 'react-native';

import { colors } from '@/lib/colors';
import { getSupabase } from '@/lib/supabase';
import type { AssignedAgent, Objective, TicketDetail, TicketEvent } from '@/lib/types';

const eventIcons: Record<string, { name: string; color: string }> = {
  system: { name: 'settings-outline', color: colors.mutedForeground },
  question: { name: 'help-circle-outline', color: '#f59e0b' },
  answer: { name: 'chatbubble-outline', color: colors.primary },
  update: { name: 'create-outline', color: colors.primary },
  context_write: { name: 'push-outline', color: colors.mutedForeground },
  context_read: { name: 'download-outline', color: colors.mutedForeground },
  artifact: { name: 'attach-outline', color: '#8b5cf6' },
  deliver: { name: 'checkmark-circle-outline', color: colors.success },
  status_change: { name: 'swap-horizontal-outline', color: colors.primary },
  alert: { name: 'warning-outline', color: colors.destructive },
  user_follow_up: { name: 'person-outline', color: '#f59e0b' },
  ticket_reopened: { name: 'refresh-outline', color: '#f59e0b' },
};

const objectiveStateColors: Record<string, string> = {
  draft: colors.mutedForeground,
  executing: colors.primary,
  blocked: colors.destructive,
  complete: colors.success,
};

function formatAgentLabel(agent: AssignedAgent | null): string | null {
  if (!agent?.agent) return null;
  const parts = [agent.agent];
  if (agent.model) parts.push(agent.model);
  if (agent.thinking) parts.push('(thinking)');
  return parts.join(' · ');
}

export default function TicketDetailScreen() {
  const { ticketId } = useLocalSearchParams<{ ticketId: string }>();
  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const [events, setEvents] = useState<TicketEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const supabase = getSupabase();
      const [ticketRes, objectivesRes, eventsRes] = await Promise.all([
        supabase
          .from('tickets')
          .select('id, title, status, priority, execution_target, assigned_agent, due_datetime, ticket_sequence, context, constraints, acceptance_criteria, created_at, updated_at, project_id')
          .eq('id', ticketId)
          .single(),
        supabase
          .from('objectives')
          .select('id, objective, title, state, agent_identifier, model_identifier, created_at')
          .eq('ticket_id', ticketId)
          .order('created_at', { ascending: false }),
        supabase
          .from('ticket_events')
          .select('id, event_type, summary, phase, is_blocking, created_at')
          .eq('ticket_id', ticketId)
          .order('created_at', { ascending: false })
          .limit(30),
      ]);

      if (ticketRes.data) setTicket(ticketRes.data as unknown as TicketDetail);
      if (objectivesRes.data) setObjectives(objectivesRes.data);
      if (eventsRes.data) setEvents(eventsRes.data as TicketEvent[]);
      if (ticketRes.error) {
        Alert.alert('Unable to load ticket', ticketRes.error.message);
      } else if (eventsRes.error) {
        Alert.alert('Unable to load activity', eventsRes.error.message);
      }
      setLoading(false);
    }

    load();
  }, [ticketId]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!ticket) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Ticket not found</Text>
      </View>
    );
  }

  const agentLabel = formatAgentLabel(ticket.assigned_agent);

  return (
    <ScrollView style={styles.container}>
      <Stack.Screen
        options={{
          title: `#${ticket.ticket_sequence}`,
          headerShown: true,
          headerBackTitle: 'Tickets',
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.foreground,
        }}
      />

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>{ticket.title || 'Untitled'}</Text>
        <View style={styles.metaRow}>
          <View style={styles.chip}>
            <Text style={styles.chipText}>{ticket.status}</Text>
          </View>
          <View style={styles.chip}>
            <Text style={styles.chipText}>{ticket.priority}</Text>
          </View>
          <View style={styles.chip}>
            <Ionicons
              name={ticket.execution_target === 'agent' ? 'hardware-chip-outline' : 'person-outline'}
              size={12}
              color={colors.secondaryForeground}
              style={{ marginRight: 4 }}
            />
            <Text style={styles.chipText}>{ticket.execution_target}</Text>
          </View>
        </View>
        {agentLabel && (
          <View style={styles.agentRow}>
            <Ionicons name="hardware-chip-outline" size={14} color={colors.mutedForeground} />
            <Text style={styles.agentText}>{agentLabel}</Text>
          </View>
        )}
        {ticket.due_datetime && (
          <View style={styles.dueRow}>
            <Ionicons name="calendar-outline" size={14} color={colors.mutedForeground} />
            <Text style={styles.dueText}>
              Due {new Date(ticket.due_datetime).toLocaleDateString()}
            </Text>
          </View>
        )}
      </View>

      {/* Objectives */}
      {objectives.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Objectives</Text>
          {objectives.map((obj) => (
            <View key={obj.id} style={styles.objectiveCard}>
              <View style={styles.objectiveHeader}>
                <View
                  style={[
                    styles.objectiveStateDot,
                    { backgroundColor: objectiveStateColors[obj.state] ?? colors.mutedForeground },
                  ]}
                />
                <Text style={styles.objectiveState}>{obj.state}</Text>
                {obj.agent_identifier && (
                  <>
                    <Text style={styles.objectiveMetaSep}>·</Text>
                    <Text style={styles.objectiveMeta}>{obj.agent_identifier}</Text>
                  </>
                )}
                {obj.model_identifier && (
                  <>
                    <Text style={styles.objectiveMetaSep}>·</Text>
                    <Text style={styles.objectiveMeta}>{obj.model_identifier}</Text>
                  </>
                )}
              </View>
              {obj.title && (
                <Text style={styles.objectiveTitle}>{obj.title}</Text>
              )}
              <Text style={styles.objectiveText} numberOfLines={4}>
                {obj.objective}
              </Text>
            </View>
          ))}
        </View>
      )}

      {/* Context */}
      {ticket.context.trim() !== '' && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Context</Text>
          <Text style={styles.sectionBody}>{ticket.context}</Text>
        </View>
      )}

      {/* Constraints */}
      {ticket.constraints.trim() !== '' && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Constraints</Text>
          <Text style={styles.sectionBody}>{ticket.constraints}</Text>
        </View>
      )}

      {/* Acceptance Criteria */}
      {ticket.acceptance_criteria && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Acceptance Criteria</Text>
          <Text style={styles.sectionBody}>{ticket.acceptance_criteria}</Text>
        </View>
      )}

      {/* Activity */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Activity</Text>
        {events.length === 0 ? (
          <Text style={styles.noActivity}>No activity yet</Text>
        ) : (
          events.map((event) => {
            const icon = eventIcons[event.event_type] ?? { name: 'ellipse', color: colors.primary };
            return (
              <View
                key={event.id}
                style={[styles.eventCard, event.is_blocking && styles.eventBlocking]}
              >
                <View style={styles.eventHeader}>
                  <Ionicons
                    name={icon.name as keyof typeof Ionicons.glyphMap}
                    size={14}
                    color={icon.color}
                  />
                  <Text style={styles.eventType}>{event.event_type.replace(/_/g, ' ')}</Text>
                  {event.phase && <Text style={styles.eventPhase}>· {event.phase}</Text>}
                  {event.is_blocking && (
                    <View style={styles.blockingBadge}>
                      <Text style={styles.blockingText}>blocking</Text>
                    </View>
                  )}
                </View>
                {event.summary && (
                  <Text style={styles.eventSummary} numberOfLines={4}>
                    {event.summary}
                  </Text>
                )}
                <Text style={styles.eventTime}>
                  {new Date(event.created_at).toLocaleString()}
                </Text>
              </View>
            );
          })
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  errorText: {
    color: colors.mutedForeground,
    fontSize: 16,
  },
  header: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: {
    color: colors.foreground,
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 12,
  },
  metaRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.secondary,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  chipText: {
    color: colors.secondaryForeground,
    fontSize: 13,
    fontWeight: '500',
    textTransform: 'capitalize',
  },
  agentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
  },
  agentText: {
    color: colors.mutedForeground,
    fontSize: 13,
  },
  dueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
  },
  dueText: {
    color: colors.mutedForeground,
    fontSize: 13,
  },
  section: {
    padding: 16,
  },
  sectionTitle: {
    color: colors.mutedForeground,
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  sectionBody: {
    color: colors.foreground,
    fontSize: 15,
    lineHeight: 22,
  },
  objectiveCard: {
    backgroundColor: colors.card,
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  objectiveHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  objectiveStateDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  objectiveState: {
    color: colors.secondaryForeground,
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  objectiveMetaSep: {
    color: colors.mutedForeground,
    fontSize: 12,
  },
  objectiveMeta: {
    color: colors.mutedForeground,
    fontSize: 12,
  },
  objectiveTitle: {
    color: colors.foreground,
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 4,
  },
  objectiveText: {
    color: colors.secondaryForeground,
    fontSize: 14,
    lineHeight: 20,
  },
  noActivity: {
    color: colors.mutedForeground,
    fontSize: 14,
  },
  eventCard: {
    backgroundColor: colors.card,
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  eventBlocking: {
    borderColor: colors.destructive,
    borderWidth: 1,
  },
  eventHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  eventType: {
    color: colors.foreground,
    fontSize: 14,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  eventPhase: {
    color: colors.mutedForeground,
    fontSize: 13,
  },
  blockingBadge: {
    backgroundColor: colors.destructive,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginLeft: 'auto',
  },
  blockingText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  eventSummary: {
    color: colors.secondaryForeground,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 4,
    marginBottom: 4,
  },
  eventTime: {
    color: colors.mutedForeground,
    fontSize: 12,
    marginTop: 4,
  },
});
