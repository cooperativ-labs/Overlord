import { useCallback, useEffect, useRef, useState } from 'react';

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
        (payload: { new: FeedPost }) => {
          const row = payload.new as FeedPost;
          if (knownIdsRef.current.has(row.id)) return;
          knownIdsRef.current.add(row.id);

          setNewPosts(prev => {
            if (prev.some(p => p.id === row.id)) return prev;
            return [row, ...prev];
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
