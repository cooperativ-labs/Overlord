// deno-lint-ignore-file no-explicit-any
import { type SupabaseClient } from '@supabase/supabase-js';

export async function resolveTicketProjectContext(supabase: SupabaseClient, ticketId: string) {
  const { data, error } = await supabase
    .from('tickets')
    .select('organization_id,project_id')
    .eq('id', ticketId)
    .maybeSingle();

  if (error || !data) return null;
  return data;
}

export async function insertChangeRationales(
  supabase: SupabaseClient,
  input: {
    changeRationales: any[];
    eventId: string;
    organizationId: number;
    projectId: string;
    sessionId: string;
    ticketId: string;
  }
) {
  if (!input.changeRationales.length) {
    return { count: 0, error: null };
  }

  const { error } = await supabase.from('change_rationales').insert(
    input.changeRationales.map(rationale => ({
      attribution_source: rationale.attribution_source ?? 'explicit',
      change_kind: rationale.change_kind ?? 'modify',
      confidence: rationale.confidence ?? 'explicit',
      event_id: input.eventId,
      file_path: rationale.file_path,
      hunks: Array.isArray(rationale.hunks) ? rationale.hunks : [],
      impact: rationale.impact,
      label: rationale.label,
      organization_id: input.organizationId,
      project_id: input.projectId,
      session_id: input.sessionId,
      summary: rationale.summary,
      ticket_id: input.ticketId,
      why: rationale.why
    }))
  );

  return {
    count: input.changeRationales.length,
    error: error?.message ?? null
  };
}
