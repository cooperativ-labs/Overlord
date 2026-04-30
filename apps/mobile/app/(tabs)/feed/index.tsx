import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ExecutingTicketsSection } from '@/components/ExecutingTicketsSection';
import { type ThemeColors, useThemeColors, useThemedStyles } from '@/lib/colors';
import { loadFeedPosts } from '@/lib/feed-posts';
import { useExecutingFeedTickets } from '@/lib/hooks/use-executing-feed-tickets';
import { useFeedRealtime } from '@/lib/hooks/use-feed-realtime';
import { loadProjectSummaries, type ProjectSummary } from '@/lib/projects';
import type { FeedPost } from '@/lib/types';

function getImpactConfig(
  colors: ThemeColors
): Record<string, { label: string; color: string; backgroundColor: string }> {
  return {
    minor: {
      label: 'Minor',
      color: colors.mutedForeground,
      backgroundColor: colors.muted
    },
    notable: {
      label: 'Notable',
      color: colors.isDark ? '#60a5fa' : '#1d4ed8',
      backgroundColor: 'rgba(59, 130, 246, 0.16)'
    },
    significant: {
      label: 'Significant',
      color: colors.isDark ? '#fbbf24' : '#b45309',
      backgroundColor: 'rgba(245, 158, 11, 0.16)'
    }
  };
}

export default function FeedScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const styles = useThemedStyles(createStyles);
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [loadingPosts, setLoadingPosts] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedPostIds, setExpandedPostIds] = useState<Set<string>>(new Set());
  const [selectedProjectId, setSelectedProjectId] = useState<string | 'all'>('all');
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);

  const executingTickets = useExecutingFeedTickets();
  const { newPosts, markKnown } = useFeedRealtime();
  const impactConfig = getImpactConfig(colors);

  useEffect(() => {
    let cancelled = false;

    setLoadingProjects(true);

    void loadProjectSummaries()
      .then(data => {
        if (!cancelled) {
          setProjects(data);
        }
      })
      .catch(error => {
        if (!cancelled) {
          Alert.alert(
            'Unable to load projects',
            error instanceof Error ? error.message : 'Unknown error'
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingProjects(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const fetchPosts = useCallback(async () => {
    try {
      const nextPosts = await loadFeedPosts(selectedProjectId === 'all' ? null : selectedProjectId);
      setPosts(nextPosts);
      markKnown(nextPosts.map(p => p.id));
    } catch (error) {
      Alert.alert('Unable to load feed', error instanceof Error ? error.message : 'Unknown error');
    }
  }, [markKnown, selectedProjectId]);

  useEffect(() => {
    setLoadingPosts(true);
    fetchPosts().finally(() => setLoadingPosts(false));
  }, [fetchPosts]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchPosts();
    setRefreshing(false);
  };

  const toggleExpanded = (postId: string) => {
    setExpandedPostIds(prev => {
      const next = new Set(prev);
      if (next.has(postId)) {
        next.delete(postId);
      } else {
        next.add(postId);
      }
      return next;
    });
  };

  const openTicket = useCallback(
    (ticketId: string) => {
      router.push({
        pathname: '/(tabs)/tickets/[ticketId]',
        params: { ticketId, returnTo: '/(tabs)/feed' }
      });
    },
    [router]
  );

  // Merge realtime posts with fetched posts
  const allPosts = useMemo(() => {
    const fetchedIds = new Set(posts.map(p => p.id));
    const realtimeOnly = newPosts.filter(p => !fetchedIds.has(p.id));
    return [...realtimeOnly, ...posts];
  }, [posts, newPosts]);

  const filteredPosts = useMemo(() => {
    if (selectedProjectId === 'all') return allPosts;
    return allPosts.filter(post => post.project_id === selectedProjectId);
  }, [allPosts, selectedProjectId]);

  const selectedProject = useMemo(
    () => projects.find(project => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId]
  );

  if (loadingPosts || loadingProjects) {
    return (
      <SafeAreaView style={styles.centered} edges={['top']}>
        <ActivityIndicator size="large" color={colors.primary} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <FlatList
        data={filteredPosts}
        keyExtractor={item => item.id}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
          />
        }
        ListHeaderComponent={
          <View style={styles.headerStack}>
            <View style={styles.filterSection}>
              <View style={styles.filterHeaderRow}>
                <Ionicons name="funnel-outline" size={14} color={colors.mutedForeground} />
                <Text style={styles.filterLabel}>Project</Text>
                {selectedProjectId !== 'all' && selectedProject ? (
                  <Text style={styles.filterSummary} numberOfLines={1}>
                    {selectedProject.name}
                  </Text>
                ) : null}
              </View>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.filterChipRow}
              >
                <Pressable
                  style={({ pressed }) => [
                    styles.filterChip,
                    selectedProjectId === 'all' && styles.filterChipSelected,
                    pressed && styles.pressed
                  ]}
                  onPress={() => setSelectedProjectId('all')}
                >
                  <Text
                    style={[
                      styles.filterChipText,
                      selectedProjectId === 'all' && styles.filterChipTextSelected
                    ]}
                  >
                    All projects
                  </Text>
                </Pressable>
                {projects.map(project => {
                  const selected = project.id === selectedProjectId;
                  return (
                    <Pressable
                      key={project.id}
                      style={({ pressed }) => [
                        styles.filterChip,
                        selected && styles.filterChipSelected,
                        pressed && styles.pressed
                      ]}
                      onPress={() => setSelectedProjectId(project.id)}
                    >
                      <View
                        style={[
                          styles.projectDot,
                          { backgroundColor: project.color || colors.primary }
                        ]}
                      />
                      <Text
                        style={[styles.filterChipText, selected && styles.filterChipTextSelected]}
                        numberOfLines={1}
                      >
                        {project.name}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>

            {executingTickets.length > 0 ? (
              <ExecutingTicketsSection tickets={executingTickets} />
            ) : null}
          </View>
        }
        renderItem={({ item }) => {
          const isExpanded = expandedPostIds.has(item.id);
          const impact = impactConfig[item.impact_level] ?? impactConfig.notable;
          const humanActions = Array.isArray(item.human_actions) ? item.human_actions : [];
          const tradeoffs = Array.isArray(item.tradeoffs) ? item.tradeoffs : [];
          const ticketsCreated = Array.isArray(item.tickets_created) ? item.tickets_created : [];
          const filesTouched = Array.isArray(item.files_touched) ? item.files_touched : [];
          const tags = Array.isArray(item.tags) ? item.tags : [];

          return (
            <Pressable
              style={styles.card}
              onPress={() => toggleExpanded(item.id)}
              accessibilityRole="button"
              accessibilityState={{ expanded: isExpanded }}
            >
              <View style={styles.cardHeader}>
                <View style={styles.headerLeft}>
                  {item.agent_type && (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>{item.agent_type}</Text>
                    </View>
                  )}
                  <View style={[styles.impactBadge, { backgroundColor: impact.backgroundColor }]}>
                    <View style={[styles.impactDot, { backgroundColor: impact.color }]} />
                    <Text style={[styles.impactText, { color: impact.color }]}>{impact.label}</Text>
                  </View>
                </View>
                <View style={styles.headerRight}>
                  <Text style={styles.timestamp}>
                    {new Date(item.created_at).toLocaleDateString()}
                  </Text>
                  <Ionicons
                    name={isExpanded ? 'chevron-up' : 'chevron-down'}
                    size={16}
                    color={colors.mutedForeground}
                  />
                </View>
              </View>
              <View style={styles.projectRow}>
                <View style={[styles.projectDot, { backgroundColor: item.project_color }]} />
                <Text style={styles.projectText} numberOfLines={1}>
                  {item.project_name}
                </Text>
              </View>
              <Pressable
                style={({ pressed }) => [styles.ticketLinkRow, pressed && styles.pressed]}
                onPress={() => openTicket(item.ticket_id)}
                accessibilityRole="link"
                accessibilityLabel={`Open ticket ${item.ticket_sequence ? `#${item.ticket_sequence} ` : ''}${item.ticket_title ?? 'Untitled ticket'}`}
              >
                <Text style={styles.ticketLinkText} numberOfLines={2}>
                  {item.ticket_sequence ? `#${item.ticket_sequence} ` : ''}
                  {item.ticket_title ?? 'Untitled ticket'}
                </Text>
                <Ionicons name="open-outline" size={14} color={colors.primary} />
              </Pressable>
              <Text style={styles.title} numberOfLines={isExpanded ? undefined : 2}>
                {item.title}
              </Text>
              <Text style={styles.body} numberOfLines={isExpanded ? undefined : 3}>
                {item.body}
              </Text>

              {!isExpanded && humanActions.length > 0 && (
                <View style={styles.humanActionsPreview}>
                  {humanActions.slice(0, 2).map((action, index) => (
                    <View key={`${item.id}-preview-${index}`} style={styles.listRow}>
                      <Text style={styles.listBullet}>{'\u2022'}</Text>
                      <Text style={styles.humanActionsPreviewText}>{action}</Text>
                    </View>
                  ))}
                  {humanActions.length > 2 && (
                    <Text style={styles.humanActionsMore}>+{humanActions.length - 2} more</Text>
                  )}
                </View>
              )}

              {isExpanded && humanActions.length > 0 && (
                <View style={styles.calloutBlue}>
                  <View style={styles.calloutHeader}>
                    <Ionicons
                      name="checkmark-circle-outline"
                      size={16}
                      color={colors.isDark ? '#60a5fa' : '#1d4ed8'}
                    />
                    <Text style={styles.calloutBlueTitle}>Action required</Text>
                  </View>
                  {humanActions.map((action, index) => (
                    <View key={`${item.id}-action-${index}`} style={styles.listRow}>
                      <Text style={styles.listBullet}>{'\u2022'}</Text>
                      <Text style={styles.calloutBlueText}>{action}</Text>
                    </View>
                  ))}
                </View>
              )}

              {isExpanded && tradeoffs.length > 0 && (
                <View style={styles.sectionStack}>
                  {tradeoffs.map((tradeoff, index) => (
                    <View key={`${item.id}-tradeoff-${index}`} style={styles.calloutAmber}>
                      <View style={styles.calloutHeader}>
                        <Ionicons
                          name="warning-outline"
                          size={16}
                          color={colors.isDark ? '#fbbf24' : '#b45309'}
                        />
                        <Text style={styles.calloutAmberTitle}>{tradeoff.decision}</Text>
                      </View>
                      {tradeoff.alternatives_considered ? (
                        <Text style={styles.calloutAmberText}>
                          Alternatives: {tradeoff.alternatives_considered}
                        </Text>
                      ) : null}
                      {tradeoff.rationale ? (
                        <Text style={styles.calloutAmberText}>Rationale: {tradeoff.rationale}</Text>
                      ) : null}
                    </View>
                  ))}
                </View>
              )}

              {isExpanded && ticketsCreated.length > 0 && (
                <View style={styles.calloutViolet}>
                  <View style={styles.calloutHeader}>
                    <Ionicons
                      name="git-branch-outline"
                      size={16}
                      color={colors.isDark ? '#c084fc' : '#7c3aed'}
                    />
                    <Text style={styles.calloutVioletTitle}>Tickets created</Text>
                  </View>
                  {ticketsCreated.map(ticket => (
                    <View key={ticket.id} style={styles.listRow}>
                      <Text style={styles.listBullet}>{'\u2022'}</Text>
                      <Text style={styles.calloutVioletText}>
                        #{ticket.sequence}: {ticket.title}
                      </Text>
                    </View>
                  ))}
                </View>
              )}

              {tags.length > 0 && (
                <View style={styles.tagsRow}>
                  {(isExpanded ? tags : tags.slice(0, 3)).map(tag => (
                    <View key={tag} style={styles.tag}>
                      <Text style={styles.tagText}>{tag}</Text>
                    </View>
                  ))}
                  {!isExpanded && tags.length > 3 && (
                    <Text style={styles.moreText}>+{tags.length - 3}</Text>
                  )}
                </View>
              )}

              {filesTouched.length > 0 && (
                <View style={styles.filesBlock}>
                  <View style={styles.filesSummaryRow}>
                    <Ionicons name="document-outline" size={12} color={colors.mutedForeground} />
                    <Text style={styles.filesText}>
                      {filesTouched.length} file{filesTouched.length !== 1 ? 's' : ''} touched
                    </Text>
                  </View>
                  {isExpanded && (
                    <View style={styles.fileChipsRow}>
                      {filesTouched.map(filePath => (
                        <View key={filePath} style={styles.fileChip}>
                          <Text style={styles.fileChipText} numberOfLines={1}>
                            {filePath}
                          </Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              )}
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="newspaper-outline" size={48} color={colors.mutedForeground} />
            <Text style={styles.emptyText}>
              {selectedProjectId === 'all'
                ? 'No feed activity yet'
                : 'No activity for this project'}
            </Text>
            <Text style={styles.emptySubtext}>
              Activity from your agents and team will appear here
            </Text>
          </View>
        }
        contentContainerStyle={filteredPosts.length === 0 ? styles.emptyContainer : styles.list}
      />
    </SafeAreaView>
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
    list: {
      paddingBottom: 16
    },
    headerStack: {
      gap: 2
    },
    filterSection: {
      paddingHorizontal: 16,
      paddingTop: 10,
      paddingBottom: 6,
      gap: 10
    },
    filterHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6
    },
    filterLabel: {
      color: colors.foreground,
      fontSize: 13,
      fontWeight: '600'
    },
    filterSummary: {
      color: colors.mutedForeground,
      fontSize: 12,
      flex: 1
    },
    filterChipRow: {
      gap: 8,
      paddingRight: 16
    },
    filterChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: colors.card,
      borderRadius: 999,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderWidth: 1,
      borderColor: colors.border
    },
    filterChipSelected: {
      backgroundColor: colors.primary,
      borderColor: colors.primary
    },
    filterChipText: {
      color: colors.secondaryForeground,
      fontSize: 13,
      fontWeight: '500'
    },
    filterChipTextSelected: {
      color: colors.primaryForeground
    },
    card: {
      backgroundColor: colors.card,
      borderRadius: 12,
      padding: 16,
      marginBottom: 12,
      marginHorizontal: 16,
      borderWidth: 1,
      borderColor: colors.border
    },
    cardHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 8
    },
    headerLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      flexShrink: 1
    },
    headerRight: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8
    },
    badge: {
      backgroundColor: colors.secondary,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 6
    },
    badgeText: {
      color: colors.secondaryForeground,
      fontSize: 12,
      fontWeight: '500'
    },
    impactDot: {
      width: 6,
      height: 6,
      borderRadius: 3
    },
    impactBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      borderRadius: 999,
      paddingHorizontal: 8,
      paddingVertical: 4
    },
    impactText: {
      fontSize: 12,
      fontWeight: '600'
    },
    timestamp: {
      color: colors.mutedForeground,
      fontSize: 12
    },
    projectRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginBottom: 8
    },
    projectDot: {
      width: 8,
      height: 8,
      borderRadius: 4
    },
    ticketLinkRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginBottom: 8
    },
    ticketLinkText: {
      flex: 1,
      color: colors.primary,
      fontSize: 14,
      fontWeight: '700',
      lineHeight: 20
    },
    projectText: {
      color: colors.mutedForeground,
      fontSize: 12,
      flex: 1
    },
    title: {
      color: colors.foreground,
      fontSize: 16,
      fontWeight: '600',
      marginBottom: 4
    },
    body: {
      color: colors.secondaryForeground,
      fontSize: 14,
      lineHeight: 20
    },
    humanActionsPreview: {
      marginTop: 12,
      backgroundColor: 'rgba(59, 130, 246, 0.12)',
      borderColor: colors.isDark ? 'rgba(59, 130, 246, 0.24)' : 'rgba(59, 130, 246, 0.35)',
      borderWidth: 1,
      borderRadius: 10,
      padding: 12,
      gap: 6
    },
    humanActionsPreviewText: {
      color: colors.isDark ? '#bfdbfe' : '#1e40af',
      fontSize: 13,
      flex: 1,
      lineHeight: 18
    },
    humanActionsMore: {
      color: colors.isDark ? '#93c5fd' : '#1d4ed8',
      fontSize: 12,
      marginLeft: 12
    },
    sectionStack: {
      gap: 10,
      marginTop: 12
    },
    calloutBlue: {
      marginTop: 12,
      backgroundColor: 'rgba(59, 130, 246, 0.12)',
      borderColor: colors.isDark ? 'rgba(59, 130, 246, 0.24)' : 'rgba(59, 130, 246, 0.35)',
      borderWidth: 1,
      borderRadius: 10,
      padding: 12,
      gap: 6
    },
    calloutAmber: {
      backgroundColor: 'rgba(245, 158, 11, 0.12)',
      borderColor: colors.isDark ? 'rgba(245, 158, 11, 0.24)' : 'rgba(245, 158, 11, 0.40)',
      borderWidth: 1,
      borderRadius: 10,
      padding: 12,
      gap: 6
    },
    calloutViolet: {
      marginTop: 12,
      backgroundColor: 'rgba(168, 85, 247, 0.12)',
      borderColor: colors.isDark ? 'rgba(168, 85, 247, 0.24)' : 'rgba(168, 85, 247, 0.35)',
      borderWidth: 1,
      borderRadius: 10,
      padding: 12,
      gap: 6
    },
    calloutHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8
    },
    calloutBlueTitle: {
      color: colors.isDark ? '#bfdbfe' : '#1e40af',
      fontSize: 14,
      fontWeight: '600'
    },
    calloutBlueText: {
      color: colors.isDark ? '#bfdbfe' : '#1e40af',
      fontSize: 13,
      flex: 1,
      lineHeight: 18
    },
    calloutAmberTitle: {
      color: colors.isDark ? '#fde68a' : '#78350f',
      fontSize: 14,
      fontWeight: '600',
      flex: 1
    },
    calloutAmberText: {
      color: colors.isDark ? '#fde68a' : '#78350f',
      fontSize: 13,
      lineHeight: 18
    },
    calloutVioletTitle: {
      color: colors.isDark ? '#e9d5ff' : '#581c87',
      fontSize: 14,
      fontWeight: '600'
    },
    calloutVioletText: {
      color: colors.isDark ? '#e9d5ff' : '#581c87',
      fontSize: 13,
      flex: 1,
      lineHeight: 18
    },
    listRow: {
      flexDirection: 'row',
      gap: 8,
      alignItems: 'flex-start'
    },
    listBullet: {
      color: colors.mutedForeground,
      marginTop: 1
    },
    tagsRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
      marginTop: 10
    },
    tag: {
      backgroundColor: colors.muted,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 4
    },
    tagText: {
      color: colors.mutedForeground,
      fontSize: 11,
      fontWeight: '500'
    },
    moreText: {
      color: colors.mutedForeground,
      fontSize: 11,
      alignSelf: 'center'
    },
    filesRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4
    },
    filesBlock: {
      marginTop: 8,
      gap: 8
    },
    filesSummaryRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4
    },
    filesText: {
      color: colors.mutedForeground,
      fontSize: 12
    },
    fileChipsRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6
    },
    fileChip: {
      maxWidth: '100%',
      backgroundColor: colors.muted,
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 6
    },
    fileChipText: {
      color: colors.secondaryForeground,
      fontSize: 12
    },
    pressed: {
      opacity: 0.7
    },
    emptyContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center'
    },
    empty: {
      alignItems: 'center',
      paddingHorizontal: 32
    },
    emptyText: {
      color: colors.foreground,
      fontSize: 18,
      fontWeight: '600',
      marginTop: 16
    },
    emptySubtext: {
      color: colors.mutedForeground,
      fontSize: 14,
      textAlign: 'center',
      marginTop: 8
    }
  });
