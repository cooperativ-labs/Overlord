import type { SupabaseClient } from '@supabase/supabase-js';

import {
  lastRollupObjectiveId,
  normalizeFeedRollupObjectiveSections
} from '@/lib/helpers/feed-post-rollup';
import type { Database } from '@/types/database.types';

type ServerSupabase = SupabaseClient<Database>;

export type ResolveProtocolObjectiveResult =
  | { ok: true; objectiveId: string | null; objectiveText: string; feedPostId?: string }
  | { ok: false; error: string };

/**
 * Resolves the objective text shown in agent context prompts.
 * When `feedPostId` is set, prefer the latest objective pointer linked from that
 * ticket-level feed post rollup instead of a newer draft on the ticket.
 */
export async function resolveProtocolObjectiveText(input: {
  supabase: ServerSupabase;
  ticketId: string;
  organizationId: number;
  feedPostId?: string | null;
}): Promise<ResolveProtocolObjectiveResult> {
  const { supabase, ticketId, organizationId, feedPostId } = input;

  if (feedPostId?.trim()) {
    const { data: feedPost, error: feedError } = await supabase
      .from('feed_posts')
      .select('id, ticket_id, organization_id, objective_id, objective_sections')
      .eq('id', feedPostId.trim())
      .maybeSingle();

    if (feedError || !feedPost) {
      return { ok: false, error: 'Feed post not found.' };
    }

    if (feedPost.ticket_id !== ticketId || feedPost.organization_id !== organizationId) {
      return { ok: false, error: 'Feed post does not match this ticket.' };
    }

    let pointerObjectiveId = feedPost.objective_id?.trim() || null;
    if (!pointerObjectiveId) {
      const fromRollup = lastRollupObjectiveId(
        normalizeFeedRollupObjectiveSections(feedPost.objective_sections)
      );
      if (fromRollup) pointerObjectiveId = fromRollup;
    }

    if (pointerObjectiveId) {
      const { data: linkedObjective } = await supabase
        .from('objectives')
        .select('id, objective')
        .eq('id', pointerObjectiveId)
        .maybeSingle();

      const text = linkedObjective?.objective?.trim();
      if (text) {
        return {
          ok: true,
          objectiveId: linkedObjective?.id ?? pointerObjectiveId,
          objectiveText: text,
          feedPostId: feedPost.id
        };
      }
    }

    const { data: completeObjective } = await supabase
      .from('objectives')
      .select('id, objective')
      .eq('ticket_id', ticketId)
      .eq('state', 'complete')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const completeText = completeObjective?.objective?.trim();
    if (completeText) {
      return {
        ok: true,
        objectiveId: completeObjective?.id ?? null,
        objectiveText: completeText,
        feedPostId: feedPost.id
      };
    }

    const fallback = await resolveLatestTrackedObjective(supabase, ticketId);
    if (fallback) {
      return {
        ok: true,
        objectiveId: fallback.id,
        objectiveText: fallback.objective,
        feedPostId: feedPost.id
      };
    }

    return {
      ok: true,
      objectiveId: pointerObjectiveId,
      objectiveText:
        '_(No objective text on file for this feed post — rely on the feed post section and ticket metadata below.)_',
      feedPostId: feedPost.id
    };
  }

  const tracked = await resolveLatestTrackedObjective(supabase, ticketId);
  if (!tracked) {
    return { ok: false, error: 'No objective found for this ticket.' };
  }
  return { ok: true, objectiveId: tracked.id, objectiveText: tracked.objective };
}

async function resolveLatestTrackedObjective(
  supabase: ServerSupabase,
  ticketId: string
): Promise<{ id: string; objective: string } | null> {
  const { data: executingObjective } = await supabase
    .from('objectives')
    .select('id, objective')
    .eq('ticket_id', ticketId)
    .eq('state', 'executing')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const fromExecuting = executingObjective?.objective?.trim();
  if (fromExecuting && executingObjective?.id) {
    return { id: executingObjective.id, objective: fromExecuting };
  }

  const { data: submittedObjective } = await supabase
    .from('objectives')
    .select('id, objective')
    .eq('ticket_id', ticketId)
    .eq('state', 'submitted')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const fromSubmitted = submittedObjective?.objective?.trim();
  if (fromSubmitted && submittedObjective?.id) {
    return { id: submittedObjective.id, objective: fromSubmitted };
  }

  const { data: draftObjective } = await supabase
    .from('objectives')
    .select('id, objective')
    .eq('ticket_id', ticketId)
    .eq('state', 'draft')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const fromDraft = draftObjective?.objective?.trim();
  if (fromDraft && draftObjective?.id) {
    return { id: draftObjective.id, objective: fromDraft };
  }
  return null;
}
