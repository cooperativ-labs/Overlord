import type { SupabaseClient } from '@supabase/supabase-js';

import {
  buildFeedDiscussLayeredTaskMarkdown,
  type FeedDiscussTicketIntent
} from '@/lib/overlord/feed-discuss-appendix';
import type { Database } from '@/types/database.types';

type ServerSupabase = SupabaseClient<Database>;

export async function loadFeedDiscussAppendMarkdown(input: {
  supabase: ServerSupabase;
  ticketId: string;
  feedPostId: string;
  initialQuestion: string;
  ticketIntent: FeedDiscussTicketIntent;
}): Promise<{ ok: true; markdown: string } | { ok: false; error: string }> {
  const { supabase, ticketId, feedPostId, initialQuestion, ticketIntent } = input;

  const { data: feedPostRow, error: feedPostError } = await supabase
    .from('feed_posts')
    .select('*')
    .eq('id', feedPostId.trim())
    .eq('ticket_id', ticketId)
    .single();

  if (feedPostError || !feedPostRow) {
    return { ok: false, error: 'Feed post not found for this ticket.' };
  }

  const fileQuery = supabase
    .from('file_changes')
    .select('file_path,summary,why,impact')
    .eq('ticket_id', ticketId)
    .order('created_at', { ascending: true })
    .limit(150);

  const eventQuery = supabase
    .from('ticket_events')
    .select('created_at,event_type,summary')
    .eq('ticket_id', ticketId)
    .neq('event_type', 'system')
    .order('created_at', { ascending: true })
    .limit(150);

  const [{ data: fc }, { data: ev }] = await Promise.all([fileQuery, eventQuery]);

  const markdown = buildFeedDiscussLayeredTaskMarkdown({
    feedPost: feedPostRow,
    feedPostId: feedPostRow.id,
    ticketIntent,
    fileChanges: fc ?? [],
    ticketEvents: ev ?? [],
    initialQuestion
  });

  return { ok: true, markdown };
}
