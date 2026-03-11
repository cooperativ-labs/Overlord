import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database, Json } from '@/types/database.types';

export type ChangeRationaleInput = {
  attribution_source?: string;
  change_kind?: string;
  confidence?: string;
  file_path: string;
  hunks?: Json;
  impact: string;
  label: string;
  summary: string;
  why: string;
};

type InsertChangeRationalesInput = {
  changeRationales: ChangeRationaleInput[];
  eventId: string;
  organizationId: number;
  projectId: string;
  sessionId: string;
  supabase: SupabaseClient<Database>;
  ticketId: string;
};

export async function resolveTicketProjectContext(
  supabase: SupabaseClient<Database>,
  ticketId: string
): Promise<{ organization_id: number; project_id: string } | null> {
  const { data, error } = await supabase
    .from('tickets')
    .select('organization_id,project_id')
    .eq('id', ticketId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return data;
}

export async function insertChangeRationales({
  changeRationales,
  eventId,
  organizationId,
  projectId,
  sessionId,
  supabase,
  ticketId
}: InsertChangeRationalesInput): Promise<{ count: number; error: string | null }> {
  if (changeRationales.length === 0) {
    return { count: 0, error: null };
  }

  const rows: Database['public']['Tables']['change_rationales']['Insert'][] = changeRationales.map(
    rationale => ({
      attribution_source: rationale.attribution_source ?? 'explicit',
      change_kind: rationale.change_kind ?? 'modify',
      confidence: rationale.confidence ?? 'explicit',
      event_id: eventId,
      file_path: rationale.file_path,
      hunks: rationale.hunks ?? [],
      impact: rationale.impact,
      label: rationale.label,
      organization_id: organizationId,
      project_id: projectId,
      session_id: sessionId,
      summary: rationale.summary,
      ticket_id: ticketId,
      why: rationale.why
    })
  );

  const { error } = await supabase.from('change_rationales').insert(rows);
  return {
    count: rows.length,
    error: error?.message ?? null
  };
}
