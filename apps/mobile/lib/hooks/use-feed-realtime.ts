import { useCallback, useEffect, useRef, useState } from 'react';

import { enrichFeedPost, type FeedPostInsertRow } from '@/lib/feed-posts';
import { getSupabase } from '@/lib/supabase';
import type { FeedPost } from '@/lib/types';

/**
 * Subscribes to feed_posts inserts and updates via Supabase Realtime.
 * Ticket rollup posts mutate in place, so updates replace existing entries.
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

    async function handleChangedRow(row: FeedPostInsertRow, announceIfNew: boolean) {
      const wasKnown = knownIdsRef.current.has(row.id);
      knownIdsRef.current.add(row.id);

      const enriched = await enrichFeedPost(row);
      setNewPosts(prev => {
        const next = [enriched, ...prev.filter(p => p.id !== enriched.id)].sort(
          (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
        );
        return announceIfNew && !wasKnown ? next : next.filter(p => p.id !== enriched.id);
      });
    }

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
          await handleChangedRow(payload.new, true);
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'feed_posts'
        },
        async (payload: { new: FeedPostInsertRow }) => {
          await handleChangedRow(payload.new, false);
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);

  return { newPosts, markKnown };
}
