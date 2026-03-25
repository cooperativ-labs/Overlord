'use client';

import { Newspaper } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import type { ExecutingFeedTicket, FeedPost } from '@/lib/actions/feed';
import { getWorkspaceRoot } from '@/lib/env';
import { useExecutingFeedTickets } from '@/lib/hooks/use-executing-feed-tickets';
import { useFeedRealtime } from '@/lib/hooks/use-feed-realtime';

import { ExecutingTicketsSection } from './ExecutingTicketsSection';
import { FeedCard } from './FeedCard';
import { FeedProjectFilter } from './FeedProjectFilter';

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

  // Mark server-fetched post IDs as known so the realtime hook skips them
  useEffect(() => {
    markKnown(posts.map(p => p.id));
  }, [posts, markKnown]);

  const workspaceRootByProjectId = useMemo(
    () =>
      new Map(
        projects.map(project => [project.id, getWorkspaceRoot(project.localWorkingDirectory)])
      ),
    [projects]
  );

  // Merge realtime posts with server-fetched posts, deduped and sorted newest first
  const allPosts = useMemo(() => {
    const serverIds = new Set(posts.map(p => p.id));
    const realtimeOnly = newPosts.filter(p => !serverIds.has(p.id));
    return [...realtimeOnly, ...posts];
  }, [posts, newPosts]);

  const filteredPosts = useMemo(() => {
    if (selectedProjectId === 'all') return allPosts;
    return allPosts.filter(p => p.project_id === selectedProjectId);
  }, [allPosts, selectedProjectId]);

  const filteredExecutingTickets = useMemo(() => {
    if (selectedProjectId === 'all') return liveExecutingTickets;
    return liveExecutingTickets.filter(ticket => ticket.project_id === selectedProjectId);
  }, [liveExecutingTickets, selectedProjectId]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 px-6 py-4 border-b shrink-0">
        <h1 className="text-lg font-semibold">Feed</h1>
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
        </div>
      </div>
    </div>
  );
}
