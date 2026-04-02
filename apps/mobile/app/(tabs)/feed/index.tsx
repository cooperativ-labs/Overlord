import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { colors } from '@/lib/colors';
import { getSupabase } from '@/lib/supabase';
import type { FeedPost } from '@/lib/types';

const impactColors: Record<string, string> = {
  high: colors.destructive,
  medium: '#f59e0b',
  low: colors.mutedForeground,
};

export default function FeedScreen() {
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchPosts = async () => {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('feed_posts')
      .select('id, title, body, impact_level, agent_type, tags, files_touched, ticket_id, created_at')
      .order('created_at', { ascending: false })
      .limit(50);

    if (!error && data) {
      setPosts(data);
      return;
    }

    if (error) {
      Alert.alert('Unable to load feed', error.message);
    }
  };

  useEffect(() => {
    fetchPosts().finally(() => setLoading(false));
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchPosts();
    setRefreshing(false);
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={posts}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
          />
        }
        renderItem={({ item }) => (
          <Pressable style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.headerLeft}>
                {item.agent_type && (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{item.agent_type}</Text>
                  </View>
                )}
                <View
                  style={[
                    styles.impactDot,
                    { backgroundColor: impactColors[item.impact_level] ?? colors.mutedForeground },
                  ]}
                />
                <Text style={styles.impactText}>{item.impact_level}</Text>
              </View>
              <Text style={styles.timestamp}>
                {new Date(item.created_at).toLocaleDateString()}
              </Text>
            </View>
            <Text style={styles.title} numberOfLines={2}>
              {item.title}
            </Text>
            <Text style={styles.body} numberOfLines={3}>
              {item.body}
            </Text>
            {item.tags.length > 0 && (
              <View style={styles.tagsRow}>
                {item.tags.slice(0, 3).map((tag) => (
                  <View key={tag} style={styles.tag}>
                    <Text style={styles.tagText}>{tag}</Text>
                  </View>
                ))}
                {item.tags.length > 3 && (
                  <Text style={styles.moreText}>+{item.tags.length - 3}</Text>
                )}
              </View>
            )}
            {item.files_touched.length > 0 && (
              <View style={styles.filesRow}>
                <Ionicons name="document-outline" size={12} color={colors.mutedForeground} />
                <Text style={styles.filesText}>
                  {item.files_touched.length} file{item.files_touched.length !== 1 ? 's' : ''} touched
                </Text>
              </View>
            )}
          </Pressable>
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="newspaper-outline" size={48} color={colors.mutedForeground} />
            <Text style={styles.emptyText}>No feed activity yet</Text>
            <Text style={styles.emptySubtext}>
              Activity from your agents and team will appear here
            </Text>
          </View>
        }
        contentContainerStyle={posts.length === 0 ? styles.emptyContainer : styles.list}
      />
    </View>
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
  list: {
    padding: 16,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  badge: {
    backgroundColor: colors.secondary,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  badgeText: {
    color: colors.secondaryForeground,
    fontSize: 12,
    fontWeight: '500',
  },
  impactDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  impactText: {
    color: colors.mutedForeground,
    fontSize: 12,
    textTransform: 'capitalize',
  },
  timestamp: {
    color: colors.mutedForeground,
    fontSize: 12,
  },
  title: {
    color: colors.foreground,
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  body: {
    color: colors.secondaryForeground,
    fontSize: 14,
    lineHeight: 20,
  },
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 10,
  },
  tag: {
    backgroundColor: colors.muted,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  tagText: {
    color: colors.mutedForeground,
    fontSize: 11,
    fontWeight: '500',
  },
  moreText: {
    color: colors.mutedForeground,
    fontSize: 11,
    alignSelf: 'center',
  },
  filesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 8,
  },
  filesText: {
    color: colors.mutedForeground,
    fontSize: 12,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  empty: {
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  emptyText: {
    color: colors.foreground,
    fontSize: 18,
    fontWeight: '600',
    marginTop: 16,
  },
  emptySubtext: {
    color: colors.mutedForeground,
    fontSize: 14,
    textAlign: 'center',
    marginTop: 8,
  },
});
