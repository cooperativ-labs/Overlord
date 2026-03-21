'use client';

import { Newspaper } from 'lucide-react';
import { useMemo, useState } from 'react';

import type { FeedPost } from '@/lib/actions/feed';

import { FeedCard } from './FeedCard';
import { FeedProjectFilter } from './FeedProjectFilter';

type Project = {
  id: string;
  name: string;
  color: string;
};

type FeedListProps = {
  posts: FeedPost[];
  projects: Project[];
};

export function FeedList({ posts, projects }: FeedListProps) {
  const [selectedProjectId, setSelectedProjectId] = useState('all');

  const filteredPosts = useMemo(() => {
    if (selectedProjectId === 'all') return posts;
    return posts.filter((p) => p.project_id === selectedProjectId);
  }, [posts, selectedProjectId]);

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
        {filteredPosts.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
            <Newspaper className="h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm">No feed posts yet.</p>
            <p className="text-xs text-muted-foreground/60">
              Posts are generated when agents complete work on tickets.
            </p>
          </div>
        ) : (
          <div className="max-w-2xl mx-auto">
            {filteredPosts.map((post) => (
              <FeedCard key={post.id} post={post} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
