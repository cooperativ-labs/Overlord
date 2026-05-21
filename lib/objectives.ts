import type { SupabaseClient } from '@supabase/supabase-js';

import { generateTitleWithGemini } from '@/lib/ai/generate-ticket-title';
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

export type OrderedObjectiveInput = {
  objective: string;
  title?: string;
  autoAdvance?: boolean;
  assignedAgent?: unknown;
};

type InsertOrderedObjectivesOptions = {
  createdBy?: string | null;
  firstState?: ObjectiveState;
  firstStateWhenNoActive?: ObjectiveState;
  firstStateWhenActive?: ObjectiveState;
  followingState?: ObjectiveState;
  firstExtra?: Partial<Database['public']['Tables']['objectives']['Insert']>;
};

type InsertedObjective = Pick<
  Database['public']['Tables']['objectives']['Row'],
  'id' | 'objective' | 'state' | 'position' | 'title' | 'auto_advance'
>;

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

type ObjectivePositionItem = ObjectiveTimelineItem & { position?: number | null };

type ObjectiveQueueRow = ObjectivePositionItem & {
  id: string;
  state: ObjectiveState | null;
};

export function sortObjectivesByPositionThenCreatedAt<T extends ObjectivePositionItem>(
  objectives: readonly T[]
): T[] {
  return [...objectives].sort((a, b) => {
    const positionA = typeof a.position === 'number' ? a.position : Number.POSITIVE_INFINITY;
    const positionB = typeof b.position === 'number' ? b.position : Number.POSITIVE_INFINITY;
    if (positionA !== positionB) {
      return positionA - positionB;
    }
    return toTimestamp(a.created_at) - toTimestamp(b.created_at);
  });
}

function buildPositionMapFromOrderedObjectives(
  objectives: readonly ObjectiveQueueRow[]
): Record<string, number> {
  const sortedPositions = objectives
    .map(objective => objective.position)
    .filter((position): position is number => typeof position === 'number')
    .sort((a, b) => a - b);

  return Object.fromEntries(
    objectives.map((objective, index) => [objective.id, sortedPositions[index] ?? index])
  );
}

export function computePromotedObjectivePositions(
  objectives: readonly ObjectiveQueueRow[],
  promotedObjectiveId: string
): Record<string, number> {
  const orderedObjectives = sortObjectivesByPositionThenCreatedAt(objectives);
  const promotedIndex = orderedObjectives.findIndex(
    objective => objective.id === promotedObjectiveId
  );

  if (promotedIndex === -1) {
    throw new Error('Objective not found.');
  }

  const draftIndex = orderedObjectives.findIndex(objective => objective.state === 'draft');
  if (draftIndex === -1 || draftIndex === promotedIndex) {
    return buildPositionMapFromOrderedObjectives(orderedObjectives);
  }

  const reorderedObjectives = [...orderedObjectives];
  const [promotedObjective] = reorderedObjectives.splice(promotedIndex, 1);
  reorderedObjectives.splice(draftIndex, 0, promotedObjective);

  return buildPositionMapFromOrderedObjectives(reorderedObjectives);
}

export function computeReorderedObjectivePositions(
  objectives: readonly ObjectiveQueueRow[],
  orderedObjectiveIds: readonly string[]
): Record<string, number> {
  const queuedById = new Map(objectives.map(objective => [objective.id, objective]));
  const reorderedQueue = orderedObjectiveIds
    .map(id => queuedById.get(id))
    .filter(Boolean) as ObjectiveQueueRow[];
  if (reorderedQueue.length !== orderedObjectiveIds.length) {
    throw new Error('Ordered objectives must all belong to the queued draft/future set.');
  }

  const positionPool = reorderedQueue
    .map(objective => objective.position)
    .filter((position): position is number => typeof position === 'number')
    .sort((a, b) => a - b);

  return Object.fromEntries(
    reorderedQueue.map((objective, index) => [objective.id, positionPool[index] ?? index])
  );
}

export async function persistObjectivePositions(
  supabase: ObjectiveClient,
  ticketId: string,
  positionsById: Readonly<Record<string, number>>
) {
  const updates = Object.entries(positionsById);
  if (updates.length === 0) {
    return;
  }

  const { data: ticketObjectives, error: ticketObjectivesError } = await supabase
    .from('objectives')
    .select('id,position')
    .eq('ticket_id', ticketId);

  if (ticketObjectivesError) {
    throw new Error(ticketObjectivesError.message);
  }

  const maxExistingPosition = Math.max(
    -1,
    ...((ticketObjectives ?? []) as Array<{ position: number | null }>).map(objective =>
      typeof objective.position === 'number' ? objective.position : -1
    )
  );
  const tempBase = maxExistingPosition + updates.length + 1000;

  for (const [index, [id]] of updates.entries()) {
    const { error } = await supabase
      .from('objectives')
      .update({ position: tempBase + index })
      .eq('id', id)
      .eq('ticket_id', ticketId);

    if (error) {
      throw new Error(error.message);
    }
  }

  for (const [id, position] of updates) {
    const { error } = await supabase
      .from('objectives')
      .update({ position })
      .eq('id', id)
      .eq('ticket_id', ticketId);

    if (error) {
      throw new Error(error.message);
    }
  }
}

export async function promoteNextFutureDraft(
  supabase: ObjectiveClient,
  ticketId: string
): Promise<boolean> {
  const { data: nextFuture, error: nextFutureError } = await supabase
    .from('objectives')
    .select('id')
    .eq('ticket_id', ticketId)
    .eq('state', 'future')
    .order('position', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (nextFutureError) {
    throw new Error(nextFutureError.message);
  }

  if (!nextFuture) {
    return false;
  }

  const { error: promoteError } = await supabase
    .from('objectives')
    .update({ state: 'draft', completed_at: null })
    .eq('id', nextFuture.id);

  if (promoteError) {
    throw new Error(promoteError.message);
  }

  return true;
}

export async function insertOrderedObjectives(
  supabase: ObjectiveClient,
  ticketId: string,
  objectives: readonly OrderedObjectiveInput[],
  options: InsertOrderedObjectivesOptions = {}
): Promise<InsertedObjective[]> {
  const normalizedObjectives = objectives.map(input => ({
    ...input,
    objective: normalizeObjectiveText(input.objective)
  }));

  if (normalizedObjectives.length === 0) {
    return [];
  }

  const emptyIndex = normalizedObjectives.findIndex(input => !input.objective);
  if (emptyIndex !== -1) {
    throw new Error(`Objective at index ${emptyIndex} cannot be empty.`);
  }

  const { data: existingRows, error: existingError } = await supabase
    .from('objectives')
    .select('position,state')
    .eq('ticket_id', ticketId);

  if (existingError) {
    throw new Error(existingError.message);
  }

  const maxPosition = Math.max(
    -1,
    ...((existingRows ?? []) as Array<{ position: number | null }>).map(row =>
      typeof row.position === 'number' ? row.position : -1
    )
  );
  const hasActiveObjective = ((existingRows ?? []) as Array<{ state: ObjectiveState | null }>).some(
    row => row.state === 'draft' || row.state === 'submitted' || row.state === 'executing'
  );
  const firstState =
    options.firstState ??
    (hasActiveObjective
      ? (options.firstStateWhenActive ?? 'future')
      : (options.firstStateWhenNoActive ?? 'draft'));
  const followingState = options.followingState ?? 'future';

  const rows = normalizedObjectives.map((input, index) => ({
    ...(index === 0 ? (options.firstExtra ?? {}) : {}),
    assigned_agent: (input.assignedAgent ?? null) as Json | null,
    auto_advance: input.autoAdvance ?? false,
    created_by: options.createdBy ?? null,
    objective: input.objective,
    position: maxPosition + index + 1,
    state: index === 0 ? firstState : followingState,
    ticket_id: ticketId,
    title: input.title?.trim() || null
  }));

  const { data: inserted, error: insertError } = await supabase
    .from('objectives')
    .insert(rows)
    .select('id,objective,state,position,title,auto_advance');

  if (insertError) {
    throw new Error(insertError.message);
  }

  return (inserted ?? []) as InsertedObjective[];
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

    const draft = data;

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

  const { data: draft, error } = await supabase
    .from('objectives')
    .select('id,objective,state,assigned_agent')
    .eq('ticket_id', ticketId)
    .eq('state', 'draft')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<DraftObjective>();

  if (error) throw new Error(error.message);

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
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })
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
          .order('position', { ascending: true })
          .order('created_at', { ascending: true })
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

  const promotedFuture = await promoteNextFutureDraft(supabase, ticketId);

  if (!promotedFuture) {
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
