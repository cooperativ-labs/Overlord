'use client';

import { Loader2, Newspaper } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import type { ExecutingFeedTicket } from '@/lib/actions/feed';
import { useFeedPosts } from '@/lib/client-data/feed/hooks';
import { getWorkspaceRoot } from '@/lib/env';
import { useExecutingFeedTickets } from '@/lib/hooks/use-executing-feed-tickets';
import { useFeedRealtime } from '@/lib/hooks/use-feed-realtime';
import { cacheFeedPostsForOffline } from '@/lib/offline/offline-feed-cache';

import { ExecutingTicketsSection } from './ExecutingTicketsSection';
import { FeedCard } from './FeedCard';
import type { FeedProjectWorkspace } from './FeedPostDiscussPanel';
import { FeedProjectFilter } from './FeedProjectFilter';

type Project = FeedProjectWorkspace & {
  name: string;
  color: string;
};

type FeedListProps = {
  projects: Project[];
  editorScheme: string;
  initialExecutingTickets?: ExecutingFeedTicket[];
};

export function FeedList({ projects, editorScheme, initialExecutingTickets = [] }: FeedListProps) {
  const { newPosts, markKnown } = useFeedRealtime();
  const feedQuery = useFeedPosts();
  const liveExecutingTickets = useExecutingFeedTickets(initialExecutingTickets);
  const [selectedProjectId, setSelectedProjectId] = useState('all');
  const sentinelRef = useRef<HTMLDivElement>(null);
  const isSentinelVisibleRef = useRef(false);

  const allFetchedPosts = useMemo(
    () => feedQuery.data?.pages.flat() ?? [],
    [feedQuery.data?.pages]
  );

  const loadMore = useCallback(async () => {
    if (feedQuery.isFetchingNextPage || !feedQuery.hasNextPage) return;
    await feedQuery.fetchNextPage();
  }, [feedQuery]);

  useEffect(() => {
    markKnown(allFetchedPosts.map(p => p.id));
    if (allFetchedPosts.length === 0) return;
    cacheFeedPostsForOffline(
      allFetchedPosts.slice(0, 50).map(p => ({
        id: p.id,
        title: p.title,
        body: p.body,
        project_name: p.project_name,
        project_color: p.project_color,
        ticket_identifier: p.ticket_identifier ?? null,
        ticket_title: p.ticket_title,
        ticket_sequence: p.ticket_sequence,
        impact_level: p.impact_level,
        human_actions: p.human_actions,
        created_at: p.created_at
      }))
    );
  }, [allFetchedPosts, markKnown]);

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
        isSentinelVisibleRef.current = entries[0].isIntersecting;
        if (entries[0].isIntersecting) {
          void loadMoreRef.current();
        }
      },
      { threshold: 0.1 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  // After initial load completes, trigger loadMore if the sentinel is already
  // in view (happens when the first page of posts doesn't fill the screen).
  useEffect(() => {
    if (!feedQuery.isLoading && isSentinelVisibleRef.current) {
      void loadMoreRef.current();
    }
  }, [feedQuery.isLoading]);

  const workspaceRootByProjectId = useMemo(
    () =>
      new Map(
        projects.map(project => [project.id, getWorkspaceRoot(project.localWorkingDirectory)])
      ),
    [projects]
  );

  const projectById = useMemo(
    () => new Map(projects.map(project => [project.id, project])),
    [projects]
  );

  // Merge realtime posts with fetched posts, deduped and sorted newest first
  const allPosts = useMemo(() => {
    const byId = new Map<string, (typeof allFetchedPosts)[number]>();
    for (const post of allFetchedPosts) byId.set(post.id, post);
    for (const post of newPosts) byId.set(post.id, post);
    return [...byId.values()].sort(
      (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    );
  }, [allFetchedPosts, newPosts]);

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
      <div className="flex-1 overflow-y-auto px-6 py-4 mt-4 ">
        <div className="max-w-2xl mx-auto">
          <ExecutingTicketsSection tickets={filteredExecutingTickets} />

          {feedQuery.isLoading ? (
            <div className="flex flex-col gap-6">
              {Array.from({ length: 4 }).map((_, i) => (
                <FeedCardSkeleton key={i} />
              ))}
            </div>
          ) : filteredPosts.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16">
              <Newspaper className="h-8 w-8 text-fg3/50" />
              <p className="text-sm font-medium text-fg2">No feed posts yet</p>
              <p className="text-xs text-fg3">Posts appear when agents complete work on tickets.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-6">
              <div className="flex items-center gap-2">
                <span className="eyebrow">Completed Work</span>
              </div>
              {filteredPosts.map(post => (
                <FeedCard
                  key={post.id}
                  post={post}
                  editorScheme={editorScheme}
                  workspaceRoot={workspaceRootByProjectId.get(post.project_id) ?? ''}
                  project={projectById.get(post.project_id)}
                />
              ))}
            </div>
          )}

          {/* Sentinel div that triggers loading more posts when scrolled into view */}
          <div ref={sentinelRef} className="h-1" />

          {feedQuery.isFetchingNextPage && (
            <div className="flex justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function FeedCardSkeleton() {
  return (
    <article className="group relative flex gap-3.5">
      <div className="flex flex-col items-center pt-1.5">
        <Skeleton className="h-2.5 w-2.5 rounded-full" />
        <Skeleton className="mt-1 h-full w-px flex-1" />
      </div>

      <div className="flex-1 min-w-0 pb-6">
        <div className="mb-2 flex flex-wrap items-center gap-2 text-[13px]">
          <Skeleton className="h-4 w-10" />
          <Skeleton className="h-4 w-1" />
          <Skeleton className="h-4 w-14" />
          <Skeleton className="h-4 w-1" />
          <Skeleton className="h-4 w-28 rounded-full" />
          <Skeleton className="h-4 w-1" />
          <Skeleton className="h-4 w-32" />
        </div>

        <div className="rounded-lg border bg-card p-5">
          <div className="mb-2.5 flex items-start gap-2.5">
            <Skeleton className="mt-0.5 h-4 w-4 shrink-0 rounded-sm" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-5 w-11/12" />
              <Skeleton className="h-5 w-3/4" />
            </div>
            <Skeleton className="h-6 w-16 shrink-0 rounded-full" />
          </div>

          <div className="mt-3.5 space-y-3.5">
            <div className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-11/12" />
              <Skeleton className="h-4 w-10/12" />
            </div>

            <div className="rounded-md border border-blue-200 bg-blue-50 p-3.5 dark:border-blue-800/40 dark:bg-blue-950/20">
              <div className="mb-2 flex items-center gap-1.5">
                <Skeleton className="h-4 w-4 rounded-full" />
                <Skeleton className="h-4 w-24" />
              </div>
              <div className="space-y-2">
                <Skeleton className="h-3.5 w-full" />
                <Skeleton className="h-3.5 w-5/6" />
              </div>
            </div>
          </div>

          <div className="mt-2.5 ml-6 flex flex-wrap items-center gap-1.5">
            <Skeleton className="h-3.5 w-3.5 rounded-sm" />
            <Skeleton className="h-6 w-24 rounded-full" />
            <Skeleton className="h-6 w-28 rounded-full" />
          </div>
        </div>
      </div>
    </article>
  );
}
