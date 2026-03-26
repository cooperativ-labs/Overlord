'use client';

import { Loader2, Newspaper } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { ExecutingFeedTicket, FeedPost } from '@/lib/actions/feed';
import { getFeedPostsAction } from '@/lib/actions/feed';
import { getWorkspaceRoot } from '@/lib/env';
import { useExecutingFeedTickets } from '@/lib/hooks/use-executing-feed-tickets';
import { useFeedRealtime } from '@/lib/hooks/use-feed-realtime';
import { cacheFeedPostsForOffline } from '@/lib/offline/offline-feed-cache';

import { ExecutingTicketsSection } from './ExecutingTicketsSection';
import { FeedCard } from './FeedCard';
import { FeedProjectFilter } from './FeedProjectFilter';

const PAGE_SIZE = 20;

type Project = {
  id: string;
  name: string;
  color: string;
  localWorkingDirectory: string | null;
};

type FeedListProps = {
  posts: FeedPost[];
  executingTickets: ExecutingFeedTicket[];
  projects: Project[];
  editorScheme: string;
};

export function FeedList({ posts, executingTickets, projects, editorScheme }: FeedListProps) {
  const { newPosts, markKnown } = useFeedRealtime();
  const liveExecutingTickets = useExecutingFeedTickets(executingTickets);
  const [selectedProjectId, setSelectedProjectId] = useState('all');
  const [additionalPosts, setAdditionalPosts] = useState<FeedPost[]>([]);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(posts.length >= PAGE_SIZE);
  const offsetRef = useRef(posts.length);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Mark server-fetched post IDs as known so the realtime hook skips them
  useEffect(() => {
    markKnown(posts.map(p => p.id));
  }, [posts, markKnown]);

  // Cache the most recent posts for offline display
  useEffect(() => {
    if (posts.length > 0) {
      cacheFeedPostsForOffline(
        posts.map(p => ({
          id: p.id,
          title: p.title,
          body: p.body,
          project_name: p.project_name,
          project_color: p.project_color,
          ticket_title: p.ticket_title,
          ticket_sequence: p.ticket_sequence,
          impact_level: p.impact_level,
          human_actions: p.human_actions,
          created_at: p.created_at
        }))
      );
    }
  }, [posts]);

  const loadMore = useCallback(async () => {
    if (isLoadingMore || !hasMore) return;
    setIsLoadingMore(true);
    try {
      const more = await getFeedPostsAction({ limit: PAGE_SIZE, offset: offsetRef.current });
      if (more.length > 0) {
        markKnown(more.map(p => p.id));
        setAdditionalPosts(prev => [...prev, ...more]);
        offsetRef.current += more.length;
      }
      if (more.length < PAGE_SIZE) {
        setHasMore(false);
      }
    } finally {
      setIsLoadingMore(false);
    }
  }, [isLoadingMore, hasMore, markKnown]);

  // Keep a stable ref to the latest loadMore so the observer never goes stale
  const loadMoreRef = useRef(loadMore);
  useEffect(() => {
    loadMoreRef.current = loadMore;
  }, [loadMore]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      entries => {
        if (entries[0].isIntersecting) {
          void loadMoreRef.current();
        }
      },
      { threshold: 0.1 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  const workspaceRootByProjectId = useMemo(
    () =>
      new Map(
        projects.map(project => [project.id, getWorkspaceRoot(project.localWorkingDirectory)])
      ),
    [projects]
  );

  // Merge realtime posts with server-fetched posts, deduped and sorted newest first
  const allPosts = useMemo(() => {
    const serverIds = new Set([...posts.map(p => p.id), ...additionalPosts.map(p => p.id)]);
    const realtimeOnly = newPosts.filter(p => !serverIds.has(p.id));
    return [...realtimeOnly, ...posts, ...additionalPosts];
  }, [posts, additionalPosts, newPosts]);

  const filteredPosts = useMemo(() => {
    if (selectedProjectId === 'all') return allPosts;
    return allPosts.filter(p => p.project_id === selectedProjectId);
  }, [allPosts, selectedProjectId]);

  const filteredExecutingTickets = useMemo(() => {
    if (selectedProjectId === 'all') return liveExecutingTickets;
    return liveExecutingTickets.filter(ticket => ticket.project_id === selectedProjectId);
  }, [liveExecutingTickets, selectedProjectId]);

  return (
    <div className="flex flex-col h-full overflow-hidden relative">
      {/* Project filter pinned to top right */}
      <div className="absolute top-4 right-6 z-10">
        <FeedProjectFilter
          projects={projects}
          value={selectedProjectId}
          onChange={setSelectedProjectId}
        />
      </div>

      {/* Feed content */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="max-w-2xl mx-auto">
          <ExecutingTicketsSection tickets={filteredExecutingTickets} />

          {filteredPosts.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
              <Newspaper className="h-10 w-10 text-muted-foreground/40" />
              <p className="text-sm">No feed posts yet.</p>
              <p className="text-xs text-muted-foreground/60">
                Posts are generated when agents complete work on tickets.
              </p>
            </div>
          ) : (
            filteredPosts.map(post => (
              <FeedCard
                key={post.id}
                post={post}
                editorScheme={editorScheme}
                workspaceRoot={workspaceRootByProjectId.get(post.project_id) ?? ''}
              />
            ))
          )}

          {/* Sentinel div that triggers loading more posts when scrolled into view */}
          <div ref={sentinelRef} className="h-1" />

          {isLoadingMore && (
            <div className="flex justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
