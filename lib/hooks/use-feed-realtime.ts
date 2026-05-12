'use client';

import { type InfiniteData, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { FeedPost } from '@/lib/actions/feed';
import { feedQueryKeys } from '@/lib/client-data/feed/query-keys';
import { createClient } from '@/supabase/utils/client';
import type { Database } from '@/types/database.types';

type FeedPostRow = Database['public']['Tables']['feed_posts']['Row'];

/**
 * Subscribes to feed_posts inserts and updates via Supabase Realtime.
 * Ticket rollup posts mutate in place, so updates replace existing cached
 * items and are re-sorted by updated_at.
 */
export function useFeedRealtime() {
  const queryClient = useQueryClient();
  const [newPosts, setNewPosts] = useState<FeedPost[]>([]);
  const knownIdsRef = useRef<Set<string>>(new Set());

  const markKnown = useCallback((ids: string[]) => {
    for (const id of ids) {
      knownIdsRef.current.add(id);
    }
  }, []);

  useEffect(() => {
    const supabase = createClient();

    async function enrichPost(row: FeedPostRow): Promise<FeedPost | null> {
      if (!row.project_id) {
        return null;
      }

      // Fetch project info
      const { data: project } = await supabase
        .from('projects')
        .select('name, color')
        .eq('id', row.project_id)
        .single();

      // Fetch ticket info
      const { data: ticket } = await supabase
        .from('tickets')
        .select('title, ticket_id, ticket_sequence')
        .eq('id', row.ticket_id)
        .single();

      // Prefer the linked objective via objective_id FK, fall back to latest draft
      let objectiveText: string | null = null;
      if (row.objective_id) {
        const { data: linked } = await supabase
          .from('objectives')
          .select('objective')
          .eq('id', row.objective_id)
          .maybeSingle();
        objectiveText = linked?.objective ?? null;
      }
      if (!objectiveText) {
        const { data: objective } = await supabase
          .from('objectives')
          .select('objective')
          .eq('ticket_id', row.ticket_id)
          .eq('state', 'draft')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        objectiveText = objective?.objective ?? null;
      }

      // Fetch file changes
      const { data: fileChanges } = await supabase
        .from('file_changes')
        .select('file_path')
        .eq('ticket_id', row.ticket_id)
        .order('created_at', { ascending: false });

      const changedFiles = [
        ...new Set((fileChanges ?? []).map(fc => fc.file_path?.trim()).filter(Boolean) as string[])
      ];
      const storedFilesTouched = Array.isArray(row.files_touched)
        ? (row.files_touched as string[]).filter(Boolean)
        : [];

      return {
        id: row.id,
        organization_id: row.organization_id,
        project_id: row.project_id,
        ticket_id: row.ticket_id,
        session_id: row.session_id,
        objective_id: row.objective_id ?? null,
        agent_type: row.agent_type,
        title: row.title,
        summary: row.summary ?? '',
        body: row.body,
        tags: row.tags ?? [],
        impact_level: row.impact_level ?? 'notable',
        files_touched: changedFiles.length > 0 ? changedFiles : storedFilesTouched,
        tradeoffs: (row.tradeoffs as FeedPost['tradeoffs']) ?? [],
        human_actions: (row.human_actions as string[]) ?? [],
        tickets_created: (row.tickets_created as FeedPost['tickets_created']) ?? [],
        objective_sections: Array.isArray(row.objective_sections)
          ? (row.objective_sections as unknown[])
          : [],
        orphan_file_changes: Array.isArray(row.orphan_file_changes)
          ? (row.orphan_file_changes as unknown[])
          : [],
        total_events: row.total_events ?? 0,
        total_files: row.total_files ?? changedFiles.length,
        pending_actions: row.pending_actions ?? 0,
        source_event_ids: row.source_event_ids ?? [],
        source_session_ids: row.source_session_ids ?? [],
        source_window_start: row.source_window_start,
        source_window_end: row.source_window_end,
        created_at: row.created_at,
        updated_at: row.updated_at,
        project_name: project?.name ?? 'Unknown',
        project_color: project?.color ?? '#6b7280',
        ticket_identifier: ticket?.ticket_id ?? null,
        ticket_title: ticket?.title ?? null,
        ticket_objective: objectiveText,
        ticket_sequence: ticket?.ticket_sequence ?? null
      };
    }

    async function handleChangedRow(row: FeedPostRow, announceIfNew: boolean) {
      const wasKnown = knownIdsRef.current.has(row.id);
      knownIdsRef.current.add(row.id);

      const enriched = await enrichPost(row);
      if (!enriched) return;

      queryClient.setQueryData<InfiniteData<FeedPost[], number>>(feedQueryKeys.posts(), current => {
        if (!current) {
          return { pageParams: [0], pages: [[enriched]] };
        }

        const pages = current.pages.map(page => page.filter(post => post.id !== enriched.id));
        const [firstPage = [], ...restPages] = pages;
        const nextFirstPage = [enriched, ...firstPage].sort(
          (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
        );

        return {
          ...current,
          pages: [nextFirstPage, ...restPages]
        };
      });

      setNewPosts(prev => {
        const next = [enriched, ...prev.filter(post => post.id !== enriched.id)].sort(
          (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
        );
        return announceIfNew && !wasKnown ? next : next.filter(post => post.id !== enriched.id);
      });
    }

    const channel = supabase
      .channel('feed-realtime')
      .on<FeedPostRow>(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'feed_posts'
        },
        async payload => {
          await handleChangedRow(payload.new, true);
        }
      )
      .on<FeedPostRow>(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'feed_posts'
        },
        async payload => {
          await handleChangedRow(payload.new, false);
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [queryClient]);

  return { newPosts, markKnown };
}
