import type { SupabaseClient } from '@supabase/supabase-js';

import { generateTitleWithGemini } from '@/lib/ai/generate-ticket-title';
import { isAppFeatureEnabled } from '@/lib/app-features';
import { parseTicketAssignedAgent } from '@/lib/helpers/ticket-assigned-agent';
import { deriveTitleFromObjective } from '@/lib/helpers/tickets';
import type { Database, Json } from '@/types/database.types';

export type ObjectiveState = Database['public']['Enums']['objective_state'];

type ObjectiveClient = SupabaseClient<Database>;

type DraftObjective = Pick<
  Database['public']['Tables']['objectives']['Row'],
  'id' | 'objective' | 'state' | 'assigned_agent'
>;

type EditableObjective = DraftObjective;

type ObjectiveTimelineItem = Pick<Database['public']['Tables']['objectives']['Row'], 'created_at'>;

type ObjectiveExecutionSnapshot = {
  agentIdentifier?: string | null;
  metadata?: Json;
  objectiveAssignedAgent?: Json | null;
};

function isObjectiveStateConstraintError(error: { code?: string; message?: string } | null) {
  const message = error?.message ?? '';
  return (
    error?.code === '23514' ||
    message.includes('objectives_state_check') ||
    message.includes('objectives_non_draft_requires_objective')
  );
}

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

export function resolveObjectiveModelIdentifier(
  executionSnapshot?: Pick<ObjectiveExecutionSnapshot, 'metadata' | 'objectiveAssignedAgent'>
): string | null {
  return (
    readModelIdentifierFromMetadata(executionSnapshot?.metadata) ??
    parseTicketAssignedAgent(executionSnapshot?.objectiveAssignedAgent ?? null)?.model ??
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
  objective: string | null | undefined,
  createdBy?: string | null
) {
  const normalizedObjective = normalizeObjectiveText(objective);
  const { data: editableObjective, error: editableObjectiveError } = await supabase
    .from('objectives')
    .select('id,objective,state,assigned_agent')
    .eq('ticket_id', ticketId)
    .eq('state', 'draft')
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
    ticket_id: ticketId,
    created_by: createdBy ?? null
  });
  if (insertDraftError) {
    throw new Error(insertDraftError.message);
  }
}

export async function submitDraftObjective(
  supabase: ObjectiveClient,
  ticketId: string,
  draftObjectiveId?: string | null
) {
  let draft: DraftObjective | null = null;

  if (draftObjectiveId) {
    // When a specific ID is provided, query without a state filter so we can
    // handle objectives that are already in `submitted` state gracefully.
    const { data, error } = await supabase
      .from('objectives')
      .select('id,objective,state,assigned_agent')
      .eq('ticket_id', ticketId)
      .eq('id', draftObjectiveId)
      .maybeSingle<DraftObjective>();

    if (error) throw new Error(error.message);

    if (!data) {
      return {
        error: 'Objective not found.',
        didSubmit: false,
        submittedObjective: null,
        submittedObjectiveId: null
      };
    }

    // Already submitted — nothing to do; let the caller proceed normally.
    if (data.state === 'submitted') {
      return {
        error: null,
        didSubmit: false,
        submittedObjective: normalizeObjectiveText(data.objective) || null,
        submittedObjectiveId: data.id
      };
    }

    if (data.state !== 'draft') {
      return {
        error: 'Objective is not in a submittable state.',
        didSubmit: false,
        submittedObjective: null,
        submittedObjectiveId: null
      };
    }

    draft = data;
  } else {
    const { data, error } = await supabase
      .from('objectives')
      .select('id,objective,state,assigned_agent')
      .eq('ticket_id', ticketId)
      .eq('state', 'draft')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle<DraftObjective>();

    if (error) throw new Error(error.message);
    draft = data;
  }

  if (!draft) {
    return { error: null, didSubmit: false, submittedObjective: null, submittedObjectiveId: null };
  }

  const normalizedObjective = normalizeObjectiveText(draft.objective);
  if (!normalizedObjective) {
    return {
      error: 'Objective cannot be empty.',
      didSubmit: false,
      submittedObjective: null,
      submittedObjectiveId: null
    };
  }

  const { error: submitError } = await supabase
    .from('objectives')
    .update({ state: 'submitted' })
    .eq('id', draft.id);
  if (submitError && !isObjectiveStateConstraintError(submitError)) {
    throw new Error(submitError.message);
  }

  return {
    error: null,
    didSubmit: true,
    submittedObjective: normalizedObjective,
    submittedObjectiveId: draft.id
  };
}

export async function markSubmittedObjectiveExecuting(
  supabase: ObjectiveClient,
  ticketId: string,
  executionSnapshot?: ObjectiveExecutionSnapshot,
  createdBy?: string | null
) {
  const { data: submittedObjective, error: submittedError } = await supabase
    .from('objectives')
    .select('id,objective,state,assigned_agent')
    .eq('ticket_id', ticketId)
    .eq('state', 'submitted')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<DraftObjective>();

  if (submittedError) {
    throw new Error(submittedError.message);
  }

  const launchObjective = submittedObjective
    ? submittedObjective
    : (
        await supabase
          .from('objectives')
          .select('id,objective,state,assigned_agent')
          .eq('ticket_id', ticketId)
          .eq('state', 'draft')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle<DraftObjective>()
      ).data;

  if (!launchObjective) {
    return { didExecute: false, executedObjective: null };
  }

  const normalizedObjective = normalizeObjectiveText(launchObjective.objective);
  if (!normalizedObjective) {
    return { didExecute: false, executedObjective: null };
  }

  const { error: executeError } = await supabase
    .from('objectives')
    .update({
      state: 'executing',
      agent_identifier: executionSnapshot?.agentIdentifier ?? null,
      model_identifier: resolveObjectiveModelIdentifier({
        metadata: executionSnapshot?.metadata,
        objectiveAssignedAgent:
          executionSnapshot?.objectiveAssignedAgent ?? launchObjective.assigned_agent
      }),
      completed_at: null
    })
    .eq('id', launchObjective.id);
  if (executeError) {
    throw new Error(executeError.message);
  }

  const { data: existingDraftRow, error: existingDraftProbeError } = await supabase
    .from('objectives')
    .select('id')
    .eq('ticket_id', ticketId)
    .eq('state', 'draft')
    .limit(1)
    .maybeSingle();

  if (existingDraftProbeError) {
    throw new Error(existingDraftProbeError.message);
  }

  if (!existingDraftRow) {
    const futureObjectivesEnabled = await isAppFeatureEnabled('future-objectives');
    let promotedFutureToDraft = false;

    if (futureObjectivesEnabled) {
      const { data: earliestFuture, error: earliestFutureError } = await supabase
        .from('objectives')
        .select('id')
        .eq('ticket_id', ticketId)
        .eq('state', 'future')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (earliestFutureError) {
        throw new Error(earliestFutureError.message);
      }

      if (earliestFuture) {
        const { error: promoteError } = await supabase
          .from('objectives')
          .update({ state: 'draft', completed_at: null })
          .eq('id', earliestFuture.id);

        if (promoteError) {
          throw new Error(promoteError.message);
        }

        promotedFutureToDraft = true;
      }
    }

    if (!promotedFutureToDraft) {
      const { error: insertDraftError } = await supabase.from('objectives').insert({
        state: 'draft',
        objective: '',
        ticket_id: ticketId,
        created_by: createdBy ?? null
      });
      if (insertDraftError) {
        throw new Error(insertDraftError.message);
      }
    }
  }

  return {
    didExecute: true,
    executedObjective: normalizedObjective,
    executedObjectiveId: launchObjective.id
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
