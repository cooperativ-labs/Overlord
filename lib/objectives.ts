import type { SupabaseClient } from '@supabase/supabase-js';

import { generateTitleWithGemini } from '@/lib/ai/generate-ticket-title';
import { deriveTitleFromObjective } from '@/lib/helpers/tickets';
import type { Database } from '@/types/database.types';

type ObjectiveClient = SupabaseClient<Database>;

type DraftObjective = Pick<
  Database['public']['Tables']['objectives']['Row'],
  'id' | 'objective' | 'is_executed'
>;

type ObjectiveTimelineItem = Pick<Database['public']['Tables']['objectives']['Row'], 'created_at'>;

function normalizeObjectiveText(value: string | null | undefined): string {
  return (value ?? '').trim();
}

function toTimestamp(value: string | null): number {
  if (!value) {
    return Number.POSITIVE_INFINITY;
  }

  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? Number.POSITIVE_INFINITY : timestamp;
}

export function sortObjectivesByCreatedAtAscending<T extends ObjectiveTimelineItem>(
  objectives: readonly T[]
): T[] {
  return [...objectives].sort((a, b) => toTimestamp(a.created_at) - toTimestamp(b.created_at));
}

export async function upsertDraftObjective(
  supabase: ObjectiveClient,
  ticketId: string,
  objective: string | null | undefined
) {
  const normalizedObjective = normalizeObjectiveText(objective);
  const { data: draft, error: draftError } = await supabase
    .from('objectives')
    .select('id,objective,is_executed')
    .eq('ticket_id', ticketId)
    .eq('is_executed', false)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<DraftObjective>();

  if (draftError) {
    throw new Error(draftError.message);
  }

  if (draft) {
    if (draft.objective !== normalizedObjective) {
      const { error: updateDraftError } = await supabase
        .from('objectives')
        .update({ objective: normalizedObjective })
        .eq('id', draft.id);
      if (updateDraftError) {
        throw new Error(updateDraftError.message);
      }
    }
    return;
  }

  const { error: insertDraftError } = await supabase.from('objectives').insert({
    is_executed: false,
    objective: normalizedObjective,
    ticket_id: ticketId
  });
  if (insertDraftError) {
    throw new Error(insertDraftError.message);
  }
}

export async function markDraftObjectiveExecuted(supabase: ObjectiveClient, ticketId: string) {
  const { data: draft, error: draftError } = await supabase
    .from('objectives')
    .select('id,objective,is_executed')
    .eq('ticket_id', ticketId)
    .eq('is_executed', false)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<DraftObjective>();

  if (draftError) {
    throw new Error(draftError.message);
  }

  if (!draft) {
    await upsertDraftObjective(supabase, ticketId, '');
    return { didExecute: false, executedObjective: null };
  }

  const normalizedObjective = normalizeObjectiveText(draft.objective);
  if (!normalizedObjective) {
    return { didExecute: false, executedObjective: null };
  }

  const { error: executeError } = await supabase
    .from('objectives')
    .update({ is_executed: true, state: 'executing' })
    .eq('id', draft.id);
  if (executeError) {
    throw new Error(executeError.message);
  }

  const { error: insertDraftError } = await supabase.from('objectives').insert({
    is_executed: false,
    objective: '',
    ticket_id: ticketId
  });
  if (insertDraftError) {
    throw new Error(insertDraftError.message);
  }

  return {
    didExecute: true,
    executedObjective: normalizedObjective,
    executedObjectiveId: draft.id
  };
}

const AI_TITLE_THRESHOLD = 100;

/**
 * Generates and persists a title for an executed objective.
 * Uses the ticket title summarizer (Gemini for long objectives, truncation for short ones).
 * Respects the user's ai_title_generation preference.
 * Designed to be called fire-and-forget so it doesn't block other processes.
 */
export async function generateAndSetObjectiveTitle(
  supabase: ObjectiveClient,
  objectiveId: string,
  objectiveText: string,
  userId: string
) {
  const normalized = objectiveText.trim();
  if (!normalized) return;

  let title: string;

  if (normalized.length <= AI_TITLE_THRESHOLD) {
    title = deriveTitleFromObjective(normalized);
  } else {
    const { data: profile } = await supabase
      .from('profiles')
      .select('ai_title_generation')
      .eq('id', userId)
      .maybeSingle();

    const aiEnabled = profile?.ai_title_generation ?? true;

    if (aiEnabled) {
      const aiTitle = await generateTitleWithGemini(normalized);
      title = aiTitle || deriveTitleFromObjective(normalized);
    } else {
      title = deriveTitleFromObjective(normalized);
    }
  }

  await supabase.from('objectives').update({ title }).eq('id', objectiveId);
}
