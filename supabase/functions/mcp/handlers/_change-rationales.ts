// deno-lint-ignore-file no-explicit-any
import { type SupabaseClient } from '@supabase/supabase-js';

function deriveFileName(filePath: string): string {
  const normalized = String(filePath ?? '')
    .replace(/\\/g, '/')
    .trim();
  const segments = normalized.split('/');
  return segments[segments.length - 1] || normalized;
}

export async function insertChangeRationales(
  supabase: SupabaseClient,
  input: {
    changeRationales: any[];
    checkpointId?: string | null;
    eventId: string;
    sessionId: string;
    ticketId: string;
  }
) {
  if (!input.changeRationales.length) {
    return { count: 0, error: null };
  }

  const { error } = await supabase.from('file_changes').insert(
    input.changeRationales.map(rationale => ({
      attribution_source: rationale.attribution_source ?? 'explicit',
      change_kind: rationale.change_kind ?? 'modify',
      confidence: rationale.confidence ?? 'explicit',
      checkpoint_id: input.checkpointId ?? null,
      event_id: input.eventId,
      file_name: deriveFileName(rationale.file_path),
      file_path: rationale.file_path,
      hunks: Array.isArray(rationale.hunks) ? rationale.hunks : [],
      impact: rationale.impact,
      label: rationale.label,
      objective_id: rationale.objective_id ?? null,
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
