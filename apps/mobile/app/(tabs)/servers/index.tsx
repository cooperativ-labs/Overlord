import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View
} from 'react-native';

import { AgentBrandIcon } from '@/components/AgentBrandIcon';
import { AGENT_OPTIONS, LAUNCH_AGENT_VALUES } from '@/lib/agent-models';
import { type ThemeColors, useThemeColors, useThemedStyles } from '@/lib/colors';
import { useExecutionTargets } from '@/lib/execution-targets-context';
import { Ionicons } from '@/lib/icons';
import type { AgentLaunchConfig, ExecutionTarget, LaunchAgentType } from '@/lib/types';

function transportLabel(transport: string): string {
  switch (transport) {
    case 'local':
      return 'Local';
    case 'ssh':
      return 'SSH';
    case 'tailscale_ssh':
      return 'Tailscale SSH';
    default:
      return transport;
  }
}

function agentLabel(agentType: string): string {
  return AGENT_OPTIONS.find(option => option.value === agentType)?.label ?? agentType;
}

function formatLastSeen(value: string | null): string {
  if (!value) return 'Never connected';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Never connected';
  return `Last seen ${date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })}`;
}

function AgentConfigRow({
  agentType,
  config,
  styles
}: {
  agentType: string;
  config: AgentLaunchConfig;
  styles: ReturnType<typeof createStyles>;
}) {
  const isBuiltIn = (LAUNCH_AGENT_VALUES as readonly string[]).includes(agentType);
  return (
    <View style={styles.agentRow}>
      <View style={styles.agentRowHeader}>
        {isBuiltIn ? <AgentBrandIcon agent={agentType as LaunchAgentType} size={14} /> : null}
        <Text style={styles.agentName}>{agentLabel(agentType)}</Text>
      </View>
      {config.preCommand ? (
        <Text style={styles.agentMono} numberOfLines={2}>
          <Text style={styles.agentMetaLabel}>pre: </Text>
          {config.preCommand}
        </Text>
      ) : null}
      {config.flags.length > 0 ? (
        <View style={styles.flagWrap}>
          {config.flags.map((flag, index) => (
            <View key={`${flag}-${index}`} style={styles.flagChip}>
              <Text style={styles.flagChipText}>{flag}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {!config.preCommand && config.flags.length === 0 ? (
        <Text style={styles.agentEmpty}>No pre-command or flags</Text>
      ) : null}
    </View>
  );
}

function TargetCard({
  target,
  selected,
  onSelect,
  colors,
  styles
}: {
  target: ExecutionTarget;
  selected: boolean;
  onSelect: () => void;
  colors: ThemeColors;
  styles: ReturnType<typeof createStyles>;
}) {
  const agentEntries = Object.entries(target.agentFlags);

  return (
    <Pressable
      onPress={onSelect}
      style={({ pressed }) => [
        styles.card,
        selected && styles.cardSelected,
        pressed && { opacity: 0.9 }
      ]}
      accessibilityRole="button"
      accessibilityState={{ selected }}
    >
      <View style={styles.cardHeader}>
        <View style={styles.cardHeaderLeft}>
          <View style={[styles.targetIcon, selected && { backgroundColor: `${colors.primary}22` }]}>
            <Ionicons
              name={target.transport === 'local' ? 'desktop-outline' : 'globe-outline'}
              size={18}
              color={selected ? colors.primary : colors.foreground}
            />
          </View>
          <View style={styles.cardHeaderText}>
            <Text style={styles.cardLabel} numberOfLines={1}>
              {target.label}
            </Text>
            <Text style={styles.cardMeta} numberOfLines={1}>
              {transportLabel(target.transport)}
              {target.platform ? ` · ${target.platform}` : ''}
              {target.host ? ` · ${target.host}` : ''}
            </Text>
          </View>
        </View>
        <Ionicons
          name={selected ? 'radio-button-on' : 'radio-button-off'}
          size={20}
          color={selected ? colors.primary : colors.mutedForeground}
        />
      </View>

      <View style={styles.statusRow}>
        <View style={styles.statusPill}>
          <View
            style={[
              styles.statusDot,
              {
                backgroundColor:
                  target.accessStatus === 'active'
                    ? '#22c55e'
                    : target.accessStatus
                      ? '#f59e0b'
                      : colors.mutedForeground
              }
            ]}
          />
          <Text style={styles.statusText}>{target.accessStatus ?? 'no access'}</Text>
        </View>
        <Text style={styles.lastSeen}>{formatLastSeen(target.lastSeenAt)}</Text>
      </View>

      <View style={styles.agentSection}>
        <Text style={styles.agentSectionTitle}>Agent launch defaults</Text>
        {agentEntries.length === 0 ? (
          <Text style={styles.agentEmpty}>
            No per-agent pre-commands or flags configured for this target.
          </Text>
        ) : (
          agentEntries.map(([agentType, config]) => (
            <AgentConfigRow key={agentType} agentType={agentType} config={config} styles={styles} />
          ))
        )}
      </View>
    </Pressable>
  );
}

export default function ServersScreen() {
  const colors = useThemeColors();
  const styles = useThemedStyles(createStyles);
  const { targets, loading, selectedTargetId, selectTarget, refresh } = useExecutionTargets();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  }, [refresh]);

  if (loading && targets.length === 0) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
      }
    >
      <Text style={styles.intro}>
        Choose the execution target the ovld runner will queue your tickets on. Your selection
        applies app-wide. The per-agent pre-commands and flags shown here are this target&apos;s
        launch defaults; edit them from the agent picker when you queue a ticket.
      </Text>

      {targets.length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons name="server-outline" size={32} color={colors.mutedForeground} />
          <Text style={styles.emptyTitle}>No execution targets</Text>
          <Text style={styles.emptyBody}>
            Connect a machine with the ovld runner to make it available here.
          </Text>
        </View>
      ) : (
        targets.map(target => (
          <TargetCard
            key={target.id}
            target={target}
            selected={target.id === selectedTargetId}
            onSelect={() => selectTarget(target.id)}
            colors={colors}
            styles={styles}
          />
        ))
      )}
    </ScrollView>
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
      alignItems: 'center',
      backgroundColor: colors.background
    },
    content: {
      padding: 16,
      gap: 12
    },
    intro: {
      color: colors.mutedForeground,
      fontSize: 13,
      lineHeight: 19
    },
    emptyState: {
      alignItems: 'center',
      gap: 8,
      paddingVertical: 48
    },
    emptyTitle: {
      color: colors.foreground,
      fontSize: 16,
      fontWeight: '600'
    },
    emptyBody: {
      color: colors.mutedForeground,
      fontSize: 14,
      textAlign: 'center',
      paddingHorizontal: 24,
      lineHeight: 20
    },
    card: {
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      padding: 14,
      gap: 12
    },
    cardSelected: {
      borderColor: colors.primary
    },
    cardHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10
    },
    cardHeaderLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      flex: 1,
      minWidth: 0
    },
    targetIcon: {
      width: 36,
      height: 36,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)'
    },
    cardHeaderText: {
      flex: 1,
      minWidth: 0
    },
    cardLabel: {
      color: colors.foreground,
      fontSize: 16,
      fontWeight: '700'
    },
    cardMeta: {
      color: colors.mutedForeground,
      fontSize: 12,
      marginTop: 2
    },
    statusRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8
    },
    statusPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6
    },
    statusDot: {
      width: 8,
      height: 8,
      borderRadius: 999
    },
    statusText: {
      color: colors.secondaryForeground,
      fontSize: 12,
      fontWeight: '600',
      textTransform: 'capitalize'
    },
    lastSeen: {
      color: colors.mutedForeground,
      fontSize: 12
    },
    agentSection: {
      gap: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      paddingTop: 10
    },
    agentSectionTitle: {
      color: colors.mutedForeground,
      fontSize: 11,
      fontWeight: '600',
      textTransform: 'uppercase',
      letterSpacing: 0.5
    },
    agentRow: {
      gap: 4
    },
    agentRowHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6
    },
    agentName: {
      color: colors.foreground,
      fontSize: 13,
      fontWeight: '600'
    },
    agentMetaLabel: {
      color: colors.mutedForeground
    },
    agentMono: {
      color: colors.secondaryForeground,
      fontSize: 12,
      fontFamily: 'monospace'
    },
    agentEmpty: {
      color: colors.mutedForeground,
      fontSize: 12,
      lineHeight: 18
    },
    flagWrap: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6
    },
    flagChip: {
      backgroundColor: colors.secondary,
      borderRadius: 6,
      paddingHorizontal: 8,
      paddingVertical: 3
    },
    flagChipText: {
      color: colors.foreground,
      fontSize: 11,
      fontFamily: 'monospace'
    }
  });
