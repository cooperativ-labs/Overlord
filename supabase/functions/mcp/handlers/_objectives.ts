// deno-lint-ignore-file no-explicit-any
import { type SupabaseClient } from '@supabase/supabase-js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TICKET_ID_REGEX = /^\d+:\d+$/;

export function normalizeObjectivesInput(args: any) {
  if (!Array.isArray(args?.objectives) || args.objectives.length === 0) {
    throw new Error('objectives is required and must be a non-empty array.');
  }
  return args.objectives.map((item: any, index: number) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`objectives[${index}] must be an object.`);
    }
    const objective = typeof item.objective === 'string' ? item.objective.trim() : '';
    if (!objective) {
      throw new Error(`objectives[${index}].objective is required.`);
    }
    return {
      objective,
      title: typeof item.title === 'string' && item.title.trim() ? item.title.trim() : null,
      autoAdvance: typeof item.autoAdvance === 'boolean' ? item.autoAdvance : false,
      assignedAgent: item.assignedAgent ?? null
    };
  });
}

export async function resolveTicketId(
  supabase: SupabaseClient,
  ticketId: string,
  organizationId: number
) {
  if (UUID_REGEX.test(ticketId)) return ticketId;
  if (!TICKET_ID_REGEX.test(ticketId)) return null;

  const { data } = await supabase
    .from('tickets')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('ticket_id', ticketId)
    .limit(2);

  if (!data || data.length !== 1) return null;
  return data[0].id;
}

export async function insertOrderedObjectives(
  supabase: SupabaseClient,
  ticketId: string,
  objectives: ReturnType<typeof normalizeObjectivesInput>,
  options: {
    createdBy: string;
    firstState?: string;
    firstStateWhenNoActive?: string;
    firstStateWhenActive?: string;
    followingState?: string;
    firstExtra?: Record<string, unknown>;
  }
) {
  if (objectives.length === 0) return [];

  const { data: existingRows, error: existingError } = await supabase
    .from('objectives')
    .select('position,state')
    .eq('ticket_id', ticketId);

  if (existingError) throw new Error(existingError.message);

  const maxPosition = Math.max(
    -1,
    ...((existingRows ?? []) as Array<{ position: number | null }>).map(row =>
      typeof row.position === 'number' ? row.position : -1
    )
  );
  const hasActiveObjective = ((existingRows ?? []) as Array<{ state: string | null }>).some(row =>
    ['draft', 'submitted', 'launching', 'executing'].includes(row.state ?? '')
  );
  const firstState =
    options.firstState ??
    (hasActiveObjective
      ? (options.firstStateWhenActive ?? 'future')
      : (options.firstStateWhenNoActive ?? 'draft'));
  const followingState = options.followingState ?? 'future';

  const rows = objectives.map(
    (
      input: {
        assignedAgent: unknown;
        autoAdvance: boolean;
        objective: string;
        title: string | null;
      },
      index: number
    ) => ({
      ...(index === 0 ? (options.firstExtra ?? {}) : {}),
      assigned_agent: input.assignedAgent,
      auto_advance: input.autoAdvance,
      created_by: options.createdBy,
      objective: input.objective,
      position: maxPosition + index + 1,
      state: index === 0 ? firstState : followingState,
      ticket_id: ticketId,
      title: input.title
    })
  );

  const { data, error } = await supabase
    .from('objectives')
    .insert(rows)
    .select('id,objective,state,position,title,auto_advance');

  if (error) throw new Error(error.message);
  return data ?? [];
}
