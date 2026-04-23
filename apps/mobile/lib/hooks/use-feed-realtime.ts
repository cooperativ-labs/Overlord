import { useCallback, useEffect, useRef, useState } from 'react';

import { enrichFeedPost, type FeedPostInsertRow } from '@/lib/feed-posts';
import { getSupabase } from '@/lib/supabase';
import type { FeedPost } from '@/lib/types';

/**
 * Subscribes to new feed_posts via Supabase Realtime.
 * New posts appear instantly without a full reload.
 */
export function useFeedRealtime() {
  const [newPosts, setNewPosts] = useState<FeedPost[]>([]);
  const knownIdsRef = useRef<Set<string>>(new Set());

  const markKnown = useCallback((ids: string[]) => {
    for (const id of ids) {
      knownIdsRef.current.add(id);
    }
  }, []);

  useEffect(() => {
    const supabase = getSupabase();

    const channel = supabase
      .channel('feed-realtime')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'feed_posts'
        },
        async (payload: { new: FeedPostInsertRow }) => {
          const row = payload.new;
          if (knownIdsRef.current.has(row.id)) return;
          knownIdsRef.current.add(row.id);

          const enriched = await enrichFeedPost(row);
          setNewPosts(prev => {
            if (prev.some(p => p.id === enriched.id)) return prev;
            return [enriched, ...prev];
          });
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);

  return { newPosts, markKnown };
}
