import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/types/database.types';

type ObjectiveClient = SupabaseClient<Database>;

type DraftObjective = Pick<
  Database['public']['Tables']['objectives']['Row'],
  'id' | 'objective' | 'is_executed'
>;

function normalizeObjectiveText(value: string | null | undefined): string {
  return (value ?? '').trim();
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
    .update({ is_executed: true })
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
    executedObjective: normalizedObjective
  };
}
