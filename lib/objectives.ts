import type { SupabaseClient } from '@supabase/supabase-js';

import { generateTitleWithGemini } from '@/lib/ai/generate-ticket-title';
import { parseTicketAssignedAgent } from '@/lib/helpers/ticket-assigned-agent';
import { deriveTitleFromObjective } from '@/lib/helpers/tickets';
import type { Database, Json } from '@/types/database.types';

type ObjectiveClient = SupabaseClient<Database>;

type DraftObjective = Pick<
  Database['public']['Tables']['objectives']['Row'],
  'id' | 'objective' | 'state'
>;

type EditableObjective = DraftObjective;

type ObjectiveTimelineItem = Pick<Database['public']['Tables']['objectives']['Row'], 'created_at'>;

type ObjectiveExecutionSnapshot = {
  agentIdentifier?: string | null;
  metadata?: Json;
  ticketAssignedAgent?: Json | null;
};

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

function readModelIdentifierFromMetadata(metadata: Json | undefined): string | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null;
  }

  const directModel =
    typeof metadata.model === 'string' && metadata.model.trim().length > 0 ? metadata.model : null;
  if (directModel) {
    return directModel.trim();
  }

  const nestedSelection = metadata.selection;
  if (
    nestedSelection &&
    typeof nestedSelection === 'object' &&
    !Array.isArray(nestedSelection) &&
    typeof nestedSelection.model === 'string' &&
    nestedSelection.model.trim().length > 0
  ) {
    return nestedSelection.model.trim();
  }

  return null;
}

function resolveObjectiveModelIdentifier(
  executionSnapshot?: Pick<ObjectiveExecutionSnapshot, 'metadata' | 'ticketAssignedAgent'>
): string | null {
  return (
    readModelIdentifierFromMetadata(executionSnapshot?.metadata) ??
    parseTicketAssignedAgent(executionSnapshot?.ticketAssignedAgent ?? null)?.model ??
    null
  );
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
  const { data: editableObjective, error: editableObjectiveError } = await supabase
    .from('objectives')
    .select('id,objective,state')
    .eq('ticket_id', ticketId)
    .in('state', ['draft', 'submitted'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<EditableObjective>();

  if (editableObjectiveError) {
    throw new Error(editableObjectiveError.message);
  }

  if (editableObjective) {
    if (editableObjective.objective !== normalizedObjective) {
      const { error: updateDraftError } = await supabase
        .from('objectives')
        .update({ objective: normalizedObjective })
        .eq('id', editableObjective.id);
      if (updateDraftError) {
        throw new Error(updateDraftError.message);
      }
    }
    return;
  }

  const { error: insertDraftError } = await supabase.from('objectives').insert({
    state: 'draft',
    objective: normalizedObjective,
    ticket_id: ticketId
  });
  if (insertDraftError) {
    throw new Error(insertDraftError.message);
  }
}

export async function submitDraftObjective(supabase: ObjectiveClient, ticketId: string) {
  const { data: draft, error: draftError } = await supabase
    .from('objectives')
    .select('id,objective,state')
    .eq('ticket_id', ticketId)
    .eq('state', 'draft')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<DraftObjective>();

  if (draftError) {
    throw new Error(draftError.message);
  }

  const normalizedObjective = normalizeObjectiveText(draft?.objective);
  if (!draft || !normalizedObjective) {
    return { didSubmit: false, submittedObjective: null, submittedObjectiveId: null };
  }

  const { error: submitError } = await supabase
    .from('objectives')
    .update({ state: 'submitted' })
    .eq('id', draft.id);
  if (submitError) {
    throw new Error(submitError.message);
  }

  return {
    didSubmit: true,
    submittedObjective: normalizedObjective,
    submittedObjectiveId: draft.id
  };
}

export async function markSubmittedObjectiveExecuting(
  supabase: ObjectiveClient,
  ticketId: string,
  executionSnapshot?: ObjectiveExecutionSnapshot
) {
  const { data: submitted, error: submittedError } = await supabase
    .from('objectives')
    .select('id,objective,state')
    .eq('ticket_id', ticketId)
    .eq('state', 'submitted')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<DraftObjective>();

  if (submittedError) {
    throw new Error(submittedError.message);
  }

  if (!submitted) {
    return { didExecute: false, executedObjective: null };
  }

  const normalizedObjective = normalizeObjectiveText(submitted.objective);
  if (!normalizedObjective) {
    return { didExecute: false, executedObjective: null };
  }

  const { error: executeError } = await supabase
    .from('objectives')
    .update({
      state: 'executing',
      agent_identifier: executionSnapshot?.agentIdentifier ?? null,
      model_identifier: resolveObjectiveModelIdentifier(executionSnapshot)
    })
    .eq('id', submitted.id);
  if (executeError) {
    throw new Error(executeError.message);
  }

  const { error: insertDraftError } = await supabase.from('objectives').insert({
    state: 'draft',
    objective: '',
    ticket_id: ticketId
  });
  if (insertDraftError) {
    throw new Error(insertDraftError.message);
  }

  return {
    didExecute: true,
    executedObjective: normalizedObjective,
    executedObjectiveId: submitted.id
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
