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
import { FeedPostCard } from '@/components/FeedPostCard';
import { type ThemeColors, useThemeColors, useThemedStyles } from '@/lib/colors';
import { loadFeedPosts } from '@/lib/feed-posts';
import { useExecutingFeedTickets } from '@/lib/hooks/use-executing-feed-tickets';
import { useFeedRealtime } from '@/lib/hooks/use-feed-realtime';
import { Ionicons } from '@/lib/icons';
import { loadProjectSummaries, type ProjectSummary } from '@/lib/projects';
import type { FeedPost } from '@/lib/types';

export default function FeedScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const styles = useThemedStyles(createStyles);
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [loadingPosts, setLoadingPosts] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedObjectiveKeys, setExpandedObjectiveKeys] = useState<Record<string, boolean>>({});
  const [selectedProjectId, setSelectedProjectId] = useState<string | 'all'>('all');
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);

  const executingTickets = useExecutingFeedTickets();
  const { newPosts, markKnown } = useFeedRealtime();

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

  const toggleObjective = useCallback((key: string) => {
    setExpandedObjectiveKeys(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const openTicket = useCallback(
    (ticketId: string) => {
      router.push({
        pathname: '/(tabs)/tickets/[ticketId]',
        params: { ticketId, returnTo: '/(tabs)/feed' }
      });
    },
    [router]
  );

  const allPosts = useMemo(() => {
    const byId = new Map<string, FeedPost>();
    for (const post of posts) byId.set(post.id, post);
    for (const post of newPosts) byId.set(post.id, post);
    return [...byId.values()].sort(
      (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    );
  }, [posts, newPosts]);

  const filteredPosts = useMemo(() => {
    if (selectedProjectId === 'all') return allPosts;
    return allPosts.filter(post => post.project_id === selectedProjectId);
  }, [allPosts, selectedProjectId]);

  if (loadingPosts || loadingProjects) {
    return (
      <SafeAreaView style={styles.centered} edges={['top']}>
        <ActivityIndicator size="large" color={colors.primary} />
      </SafeAreaView>
    );
  }

  function Header() {
    return (
      <View style={styles.headerRow}>
        <Ionicons name="newspaper-outline" size={20} color={colors.mutedForeground} />
        <Text style={styles.headerText}>Feed</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={[]}>
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
            <Header />
            <View style={styles.filterSection}>
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
        renderItem={({ item }) => (
          <FeedPostCard
            post={item}
            expandedObjectiveKeys={expandedObjectiveKeys}
            onToggleObjective={toggleObjective}
            onOpenTicket={openTicket}
          />
        )}
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
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginTop: 58,
      paddingHorizontal: 16
    },
    headerText: {
      color: colors.foreground,
      fontSize: 24,
      fontWeight: '600'
    },
    filterSection: {
      paddingHorizontal: 16,
      paddingTop: 5,
      paddingBottom: 10
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
    projectDot: {
      width: 8,
      height: 8,
      borderRadius: 4
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
