import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { type ThemeColors, useThemeColors, useThemedStyles } from '@/lib/colors';
import { Ionicons } from '@/lib/icons';
import type { FeedPost } from '@/lib/types';

import {
  type FeedRollupFileChange,
  type FeedRollupObjectiveSection,
  normalizeFeedRollupObjectiveSections,
  normalizeFeedRollupOrphanFiles
} from '../../../lib/helpers/feed-post-rollup';

type FeedPostCardProps = {
  post: FeedPost;
  expandedObjectiveKeys: Record<string, boolean>;
  onToggleObjective: (key: string) => void;
  onOpenTicket: (ticketId: string) => void;
};

type ImpactKey = 'minor' | 'notable' | 'significant';

type FileStatusGlyph = {
  ch: string;
  fg: string;
  bg: string;
};

function getFileStatusGlyph(colors: ThemeColors, status: string): FileStatusGlyph {
  const map: Record<string, FileStatusGlyph> = {
    added: {
      ch: 'A',
      fg: colors.isDark ? '#34d399' : '#047857',
      bg: colors.isDark ? 'rgba(16, 185, 129, 0.16)' : 'rgba(16, 185, 129, 0.14)'
    },
    modified: {
      ch: 'M',
      fg: colors.isDark ? '#60a5fa' : '#1d4ed8',
      bg: colors.isDark ? 'rgba(59, 130, 246, 0.18)' : 'rgba(59, 130, 246, 0.14)'
    },
    deleted: {
      ch: 'D',
      fg: colors.isDark ? '#f87171' : '#b91c1c',
      bg: colors.isDark ? 'rgba(239, 68, 68, 0.18)' : 'rgba(239, 68, 68, 0.14)'
    },
    renamed: {
      ch: 'R',
      fg: colors.isDark ? '#c084fc' : '#7c3aed',
      bg: colors.isDark ? 'rgba(168, 85, 247, 0.18)' : 'rgba(168, 85, 247, 0.14)'
    }
  };
  return map[status] ?? map.modified;
}

function getImpactStyle(
  colors: ThemeColors,
  level: string
): { label: string; fg: string; bg: string } {
  const key = (level as ImpactKey) ?? 'notable';
  if (key === 'minor') {
    return {
      label: 'Minor',
      fg: colors.mutedForeground,
      bg: colors.muted
    };
  }
  if (key === 'significant') {
    return {
      label: 'Significant',
      fg: colors.isDark ? '#fbbf24' : '#b45309',
      bg: colors.isDark ? 'rgba(245, 158, 11, 0.16)' : 'rgba(245, 158, 11, 0.16)'
    };
  }
  return {
    label: 'Notable',
    fg: colors.isDark ? '#60a5fa' : '#1d4ed8',
    bg: colors.isDark ? 'rgba(59, 130, 246, 0.18)' : 'rgba(59, 130, 246, 0.16)'
  };
}

function formatTimestamp(value: string): string {
  try {
    return new Date(value).toLocaleDateString();
  } catch {
    return value;
  }
}

function FileRow({ change }: { change: FeedRollupFileChange }) {
  const colors = useThemeColors();
  const styles = useThemedStyles(createFileRowStyles);
  const glyph = getFileStatusGlyph(colors, change.status);
  const name = change.path.split('/').pop() ?? change.path;
  const dir = change.path.slice(0, change.path.length - name.length).replace(/\/$/, '');

  return (
    <View style={styles.row}>
      <View style={[styles.glyph, { backgroundColor: glyph.bg }]}>
        <Text style={[styles.glyphText, { color: glyph.fg }]}>{glyph.ch}</Text>
      </View>
      <View style={styles.pathCol}>
        <Text style={styles.name} numberOfLines={1}>
          {name}
        </Text>
        {dir ? (
          <Text style={styles.dir} numberOfLines={1}>
            {dir}/
          </Text>
        ) : null}
      </View>
      <View style={styles.deltaCol}>
        {change.additions ? <Text style={styles.add}>+{change.additions}</Text> : null}
        {change.additions && change.deletions ? <Text style={styles.delta}> </Text> : null}
        {change.deletions ? <Text style={styles.del}>−{change.deletions}</Text> : null}
      </View>
    </View>
  );
}

function StatTile({
  value,
  label,
  tone
}: {
  value: number | string;
  label: string;
  tone?: 'blue';
}) {
  const colors = useThemeColors();
  const styles = useThemedStyles(createStatStyles);
  return (
    <View style={styles.tile}>
      <Text style={[styles.value, { color: tone === 'blue' ? colors.primary : colors.foreground }]}>
        {value}
      </Text>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

function ObjectiveItem({
  section,
  expanded,
  onToggle,
  isFirst,
  isLast
}: {
  section: FeedRollupObjectiveSection;
  expanded: boolean;
  onToggle: () => void;
  isFirst: boolean;
  isLast: boolean;
}) {
  const colors = useThemeColors();
  const styles = useThemedStyles(createObjectiveStyles);
  const isRunning = section.state === 'executing';
  const isDone = section.state === 'completed' || section.state === 'complete';
  const dotColor = isRunning ? colors.primary : isDone ? colors.success : colors.border;
  const stateLabel = isRunning ? '● Running' : isDone ? '✓ Done' : section.state.toUpperCase();
  const stateColor = isRunning ? colors.primary : isDone ? colors.success : colors.mutedForeground;

  const railTopOffset = isFirst ? 18 : 0;
  const railHasBottom = !(isLast && !expanded);

  const bodyLines = useMemo(
    () =>
      section.body
        .split(/\n+/)
        .map(line => line.replace(/^[-*]\s*/, '').trim())
        .filter(Boolean),
    [section.body]
  );

  const sectionTime = useMemo(() => {
    if (!section.updated_at) return null;
    try {
      return new Date(section.updated_at).toLocaleTimeString([], {
        hour: 'numeric',
        minute: '2-digit'
      });
    } catch {
      return null;
    }
  }, [section.updated_at]);

  return (
    <View style={styles.wrapper}>
      <View
        style={[
          styles.rail,
          {
            top: railTopOffset,
            bottom: railHasBottom ? 0 : undefined,
            height: railHasBottom ? undefined : 24
          }
        ]}
      />
      <Pressable
        style={({ pressed }) => [styles.touch, pressed && styles.pressed]}
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
      >
        <View style={[styles.dot, { backgroundColor: dotColor }]} />
        <View style={styles.body}>
          <View style={styles.metaRow}>
            <Text style={styles.objMono}>OBJ {section.index}</Text>
            <Text style={[styles.stateMono, { color: stateColor }]}>{stateLabel}</Text>
            {sectionTime ? (
              <>
                <Text style={styles.metaDot}>·</Text>
                <Text style={styles.metaTime}>{sectionTime}</Text>
              </>
            ) : null}
          </View>
          <Text style={styles.title}>{section.title}</Text>
          {!expanded && section.takeaway ? (
            <Text style={styles.takeaway}>{section.takeaway}</Text>
          ) : null}
          <View style={styles.inlineMeta}>
            <View style={styles.inlineMetaItem}>
              <Ionicons name="document-outline" size={11} color={colors.mutedForeground} />
              <Text style={styles.inlineMetaText}>{section.file_changes.length}</Text>
            </View>
            {section.duration ? (
              <>
                <Text style={styles.metaDot}>·</Text>
                <Text style={styles.inlineMetaText}>{section.duration}</Text>
              </>
            ) : null}
            {section.action_required.length > 0 ? (
              <>
                <Text style={styles.metaDot}>·</Text>
                <View style={styles.actionPill}>
                  <View style={[styles.actionDot, { backgroundColor: colors.primary }]} />
                  <Text style={[styles.actionPillText, { color: colors.primary }]}>
                    {section.action_required.length} action
                    {section.action_required.length > 1 ? 's' : ''}
                  </Text>
                </View>
              </>
            ) : null}
            <View style={styles.chevronWrap}>
              <Ionicons
                name={expanded ? 'chevron-down' : 'chevron-forward'}
                size={14}
                color={colors.mutedForeground}
              />
            </View>
          </View>
        </View>
      </Pressable>

      {(section.action_required.length > 0 || section.tradeoffs.length > 0) && (
        <View style={styles.calloutsStack}>
          {section.action_required.length > 0 ? (
            <View style={styles.calloutBlue}>
              <View style={styles.calloutHead}>
                <Ionicons
                  name="checkmark-circle-outline"
                  size={11}
                  color={colors.isDark ? '#60a5fa' : '#1d4ed8'}
                />
                <Text style={styles.calloutBlueLabel}>Action required</Text>
              </View>
              {section.action_required.map((action, i) => (
                <View key={`ar-${i}`} style={styles.calloutRow}>
                  <Text style={styles.calloutBlueBullet}>•</Text>
                  <Text style={styles.calloutBlueText}>{action}</Text>
                </View>
              ))}
            </View>
          ) : null}
          {section.tradeoffs.map((t, i) => (
            <View key={`to-${i}`} style={styles.calloutAmber}>
              <View style={styles.calloutHead}>
                <Ionicons
                  name="warning-outline"
                  size={11}
                  color={colors.isDark ? '#fbbf24' : '#b45309'}
                />
                <Text style={styles.calloutAmberLabel}>Tradeoff</Text>
              </View>
              <Text style={styles.calloutAmberDecision}>{t.decision}</Text>
              {t.rationale ? (
                <Text style={styles.calloutAmberDetail}>
                  <Text style={styles.calloutAmberKey}>Why: </Text>
                  {t.rationale}
                </Text>
              ) : null}
            </View>
          ))}
        </View>
      )}

      {expanded ? (
        <View style={styles.expandBox}>
          {bodyLines.length > 0 ? (
            <View>
              {bodyLines.map((line, i) => (
                <View key={`bl-${i}`} style={styles.calloutRow}>
                  <Text style={styles.bullet}>•</Text>
                  <Text style={styles.bodyText}>{line}</Text>
                </View>
              ))}
            </View>
          ) : null}
          {section.file_changes.length > 0 ? (
            <View style={styles.expandFiles}>
              <Text style={styles.expandFilesLabel}>Files · this objective</Text>
              {section.file_changes.map((c, i) => (
                <View
                  key={c.path}
                  style={[styles.expandFileItem, i === 0 && styles.expandFileItemFirst]}
                >
                  <FileRow change={c} />
                </View>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

export function FeedPostCard({
  post,
  expandedObjectiveKeys,
  onToggleObjective,
  onOpenTicket
}: FeedPostCardProps) {
  const colors = useThemeColors();
  const styles = useThemedStyles(createStyles);

  const sections = useMemo(
    () => normalizeFeedRollupObjectiveSections(post.objective_sections),
    [post.objective_sections]
  );
  const orphanFiles = useMemo(
    () => normalizeFeedRollupOrphanFiles(post.orphan_file_changes),
    [post.orphan_file_changes]
  );
  const useRollupUi = sections.length > 0;
  const impact = getImpactStyle(colors, post.impact_level);
  const tags = Array.isArray(post.tags) ? post.tags : [];
  const isLive = sections.some(s => s.state === 'executing');

  return (
    <View style={styles.container}>
      {/* meta row */}
      <View style={styles.metaRow}>
        <View style={[styles.projectDot, { backgroundColor: post.project_color }]} />
        <Text style={styles.projectName} numberOfLines={1}>
          {post.project_name}
        </Text>
        <Text style={styles.metaDot}>·</Text>
        <Text style={styles.timestamp}>{formatTimestamp(post.updated_at)}</Text>
        <View style={styles.metaSpacer} />
        <View style={[styles.impactPill, { backgroundColor: impact.bg }]}>
          <Text style={[styles.impactText, { color: impact.fg }]}>{impact.label}</Text>
        </View>
      </View>

      {/* ticket link */}
      <Pressable
        style={({ pressed }) => [styles.ticketLink, pressed && styles.pressed]}
        onPress={() => onOpenTicket(post.ticket_id)}
        accessibilityRole="link"
        accessibilityLabel={`Open ticket ${post.ticket_sequence ? `#${post.ticket_sequence}` : ''} ${post.ticket_title ?? 'Untitled ticket'}`}
      >
        <Text style={styles.ticketLinkText} numberOfLines={2}>
          {post.ticket_sequence ? `#${post.ticket_sequence} ` : ''}
          {post.ticket_title ?? 'Untitled ticket'}
        </Text>
        <Ionicons name="open-outline" size={14} color={colors.primary} />
      </Pressable>

      {/* summary sub-card */}
      <View style={styles.subCard}>
        <View style={styles.subCardHeader}>
          <Text style={styles.subCardLabel}>Summary</Text>
          {isLive ? (
            <View style={styles.livePill}>
              <View style={styles.liveDot} />
              <Text style={styles.liveText}>LIVE</Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.title}>{post.title}</Text>
        {post.summary?.trim() ? (
          <Text style={styles.summaryText}>{plainPreview(post.summary, 600)}</Text>
        ) : null}

        {useRollupUi ? (
          <View style={styles.statGrid}>
            <StatTile value={sections.length} label="OBJS" />
            <StatTile value={post.total_files} label="FILES" />
            <StatTile value={post.total_events} label="EVENTS" />
            <StatTile value={post.pending_actions} label="PENDING" tone="blue" />
          </View>
        ) : null}
      </View>

      {/* timeline / objectives */}
      {useRollupUi ? (
        <View style={styles.subCard}>
          <View style={styles.subCardHeader}>
            <Text style={styles.subCardLabel}>Timeline</Text>
            <Text style={styles.subCardCount}>
              {sections.length} objective{sections.length === 1 ? '' : 's'}
            </Text>
          </View>
          {sections.map((section, idx) => {
            const key = `${post.id}:${section.id}`;
            return (
              <ObjectiveItem
                key={section.id}
                section={section}
                expanded={!!expandedObjectiveKeys[key]}
                onToggle={() => onToggleObjective(key)}
                isFirst={idx === 0}
                isLast={idx === sections.length - 1}
              />
            );
          })}
        </View>
      ) : post.body?.trim() ? (
        <View style={styles.subCard}>
          <Text style={styles.bodyFallback}>{post.body}</Text>
        </View>
      ) : null}

      {/* orphan changes */}
      {orphanFiles.length > 0 ? (
        <View style={[styles.subCard, styles.orphanCard]}>
          <Text style={styles.subCardLabel}>Ticket-level changes</Text>
          <Text style={styles.orphanSubtitle}>Not linked to an objective</Text>
          <View style={styles.orphanList}>
            {orphanFiles.map((c, i) => (
              <View key={c.path} style={[styles.fileDivider, i === 0 && styles.fileDividerFirst]}>
                <FileRow change={c} />
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {/* tags */}
      {tags.length > 0 ? (
        <View style={styles.tagsRow}>
          {tags.map(tag => (
            <View key={tag} style={styles.tag}>
              <Text style={styles.tagText}>{tag}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function plainPreview(value: string, maxLen: number): string {
  if (!value.trim()) return '';
  const stripped = value
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/#+\s*/g, '')
    .replace(/\*{1,2}|_{1,2}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped.length > maxLen ? `${stripped.slice(0, maxLen - 1)}…` : stripped;
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      marginHorizontal: 12,
      marginBottom: 12,
      gap: 10
    },
    metaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 4
    },
    projectDot: {
      width: 8,
      height: 8,
      borderRadius: 4
    },
    projectName: {
      color: colors.mutedForeground,
      fontSize: 12,
      fontWeight: '500',
      maxWidth: 140
    },
    metaDot: {
      color: colors.border,
      fontSize: 12
    },
    timestamp: {
      color: colors.mutedForeground,
      fontSize: 12
    },
    metaSpacer: { flex: 1 },
    impactPill: {
      paddingHorizontal: 9,
      paddingVertical: 3,
      borderRadius: 999
    },
    impactText: {
      fontSize: 10,
      fontWeight: '700',
      letterSpacing: 0.2
    },
    ticketLink: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 4
    },
    ticketLinkText: {
      flex: 1,
      color: colors.primary,
      fontSize: 14,
      fontWeight: '700',
      lineHeight: 20
    },
    pressed: { opacity: 0.7 },
    subCard: {
      backgroundColor: colors.card,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 14,
      paddingVertical: 14,
      gap: 8
    },
    subCardHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8
    },
    subCardLabel: {
      color: colors.mutedForeground,
      fontSize: 10.5,
      fontWeight: '700',
      letterSpacing: 0.8,
      textTransform: 'uppercase'
    },
    subCardCount: {
      color: colors.mutedForeground,
      fontSize: 11
    },
    livePill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      borderWidth: 1,
      borderColor: colors.isDark ? 'rgba(34, 197, 94, 0.4)' : 'rgba(16, 185, 129, 0.45)',
      backgroundColor: colors.isDark ? 'rgba(34, 197, 94, 0.16)' : 'rgba(16, 185, 129, 0.12)',
      borderRadius: 4,
      paddingHorizontal: 5,
      paddingVertical: 1
    },
    liveDot: {
      width: 5,
      height: 5,
      borderRadius: 2.5,
      backgroundColor: colors.success
    },
    liveText: {
      color: colors.isDark ? '#86efac' : '#047857',
      fontSize: 9,
      fontWeight: '800',
      letterSpacing: 0.4
    },
    title: {
      color: colors.foreground,
      fontSize: 15,
      fontWeight: '700',
      lineHeight: 20
    },
    summaryText: {
      color: colors.secondaryForeground,
      fontSize: 14,
      lineHeight: 20
    },
    bodyFallback: {
      color: colors.secondaryForeground,
      fontSize: 14,
      lineHeight: 20
    },
    statGrid: {
      flexDirection: 'row',
      marginTop: 4,
      paddingTop: 12,
      borderTopWidth: 1,
      borderTopColor: colors.border
    },
    orphanCard: {
      borderStyle: 'dashed'
    },
    orphanSubtitle: {
      color: colors.mutedForeground,
      fontSize: 11,
      marginTop: -4
    },
    orphanList: {
      marginTop: 4
    },
    fileDivider: {
      borderTopWidth: 1,
      borderTopColor: colors.border
    },
    fileDividerFirst: {
      borderTopWidth: 0
    },
    tagsRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
      paddingHorizontal: 4
    },
    tag: {
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 999,
      paddingHorizontal: 8,
      paddingVertical: 2
    },
    tagText: {
      color: colors.mutedForeground,
      fontSize: 11,
      fontWeight: '500'
    }
  });

const createStatStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    tile: {
      flex: 1,
      alignItems: 'center'
    },
    value: {
      fontSize: 17,
      fontWeight: '700',
      lineHeight: 20
    },
    label: {
      color: colors.mutedForeground,
      fontSize: 10,
      letterSpacing: 0.8,
      marginTop: 4,
      textTransform: 'uppercase'
    }
  });

const createObjectiveStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    wrapper: {
      position: 'relative',
      paddingBottom: 12
    },
    rail: {
      position: 'absolute',
      left: 15,
      top: 0,
      bottom: 0,
      width: 1,
      backgroundColor: colors.border
    },
    touch: {
      paddingLeft: 32,
      paddingVertical: 6,
      borderRadius: 8
    },
    pressed: { opacity: 0.7 },
    dot: {
      position: 'absolute',
      left: 10,
      top: 14,
      width: 11,
      height: 11,
      borderRadius: 6,
      borderWidth: 3,
      borderColor: colors.card
    },
    body: {
      gap: 2
    },
    metaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6
    },
    objMono: {
      color: colors.mutedForeground,
      fontSize: 10.5,
      fontWeight: '700',
      letterSpacing: 0.6,
      fontVariant: ['tabular-nums']
    },
    stateMono: {
      fontSize: 10.5,
      fontWeight: '700',
      letterSpacing: 0.4
    },
    metaDot: {
      color: colors.border,
      fontSize: 11
    },
    metaTime: {
      color: colors.mutedForeground,
      fontSize: 11,
      fontVariant: ['tabular-nums']
    },
    title: {
      color: colors.foreground,
      fontSize: 14.5,
      fontWeight: '600',
      lineHeight: 19,
      marginTop: 2
    },
    takeaway: {
      color: colors.secondaryForeground,
      fontSize: 13,
      lineHeight: 18,
      marginTop: 2
    },
    inlineMeta: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginTop: 6
    },
    inlineMetaItem: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3
    },
    inlineMetaText: {
      color: colors.mutedForeground,
      fontSize: 11
    },
    actionPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4
    },
    actionDot: {
      width: 6,
      height: 6,
      borderRadius: 3
    },
    actionPillText: {
      fontSize: 11,
      fontWeight: '600'
    },
    chevronWrap: {
      marginLeft: 'auto'
    },
    calloutsStack: {
      gap: 6,
      marginTop: 8,
      paddingLeft: 32
    },
    calloutBlue: {
      borderWidth: 1,
      borderColor: colors.isDark ? 'rgba(59, 130, 246, 0.32)' : 'rgba(59, 130, 246, 0.32)',
      backgroundColor: colors.isDark ? 'rgba(59, 130, 246, 0.10)' : 'rgba(59, 130, 246, 0.08)',
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 8,
      gap: 4
    },
    calloutAmber: {
      borderWidth: 1,
      borderColor: colors.isDark ? 'rgba(245, 158, 11, 0.34)' : 'rgba(245, 158, 11, 0.38)',
      backgroundColor: colors.isDark ? 'rgba(245, 158, 11, 0.10)' : 'rgba(245, 158, 11, 0.10)',
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 8,
      gap: 2
    },
    calloutHead: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      marginBottom: 2
    },
    calloutBlueLabel: {
      color: colors.isDark ? '#93c5fd' : '#1e40af',
      fontSize: 10,
      fontWeight: '700',
      letterSpacing: 0.6,
      textTransform: 'uppercase'
    },
    calloutAmberLabel: {
      color: colors.isDark ? '#fcd34d' : '#92400e',
      fontSize: 10,
      fontWeight: '700',
      letterSpacing: 0.6,
      textTransform: 'uppercase'
    },
    calloutRow: {
      flexDirection: 'row',
      gap: 6,
      marginTop: 2
    },
    calloutBlueBullet: {
      color: colors.isDark ? '#60a5fa' : '#3b82f6',
      fontSize: 13
    },
    calloutBlueText: {
      flex: 1,
      color: colors.isDark ? '#bfdbfe' : '#1e3a8a',
      fontSize: 12.5,
      lineHeight: 17
    },
    calloutAmberDecision: {
      color: colors.isDark ? '#fde68a' : '#78350f',
      fontSize: 12.5,
      fontWeight: '600',
      lineHeight: 17
    },
    calloutAmberDetail: {
      color: colors.isDark ? '#fde68a' : '#78350f',
      fontSize: 11.5,
      lineHeight: 16,
      opacity: 0.9,
      marginTop: 2
    },
    calloutAmberKey: {
      fontWeight: '700'
    },
    expandBox: {
      marginTop: 8,
      marginLeft: 32,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)',
      borderRadius: 10,
      padding: 10,
      gap: 6
    },
    bullet: {
      color: colors.mutedForeground,
      fontSize: 13
    },
    bodyText: {
      flex: 1,
      color: colors.secondaryForeground,
      fontSize: 12.5,
      lineHeight: 18
    },
    expandFiles: {
      marginTop: 8,
      paddingTop: 8,
      borderTopWidth: 1,
      borderTopColor: colors.border
    },
    expandFilesLabel: {
      color: colors.mutedForeground,
      fontSize: 10,
      fontWeight: '700',
      letterSpacing: 0.6,
      textTransform: 'uppercase',
      marginBottom: 4
    },
    expandFileItem: {
      borderTopWidth: 1,
      borderTopColor: colors.border
    },
    expandFileItemFirst: {
      borderTopWidth: 0
    }
  });

const createFileRowStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 6
    },
    glyph: {
      width: 20,
      height: 20,
      borderRadius: 4,
      alignItems: 'center',
      justifyContent: 'center'
    },
    glyphText: {
      fontSize: 10,
      fontWeight: '800',
      fontFamily: 'Menlo'
    },
    pathCol: {
      flex: 1,
      minWidth: 0
    },
    name: {
      color: colors.foreground,
      fontSize: 12.5,
      fontFamily: 'Menlo'
    },
    dir: {
      color: colors.mutedForeground,
      fontSize: 10.5,
      fontFamily: 'Menlo'
    },
    deltaCol: {
      flexDirection: 'row',
      alignItems: 'center'
    },
    delta: {
      fontFamily: 'Menlo',
      fontSize: 11
    },
    add: {
      color: colors.isDark ? '#34d399' : '#047857',
      fontFamily: 'Menlo',
      fontSize: 11,
      fontVariant: ['tabular-nums']
    },
    del: {
      color: colors.isDark ? '#f87171' : '#dc2626',
      fontFamily: 'Menlo',
      fontSize: 11,
      fontVariant: ['tabular-nums']
    }
  });
