import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database, Json } from '@/types/database.types';

export type FileChangeInput = {
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

type InsertFileChangesInput = {
  changeRationales: FileChangeInput[];
  eventId: string;
  checkpointId?: string | null;
  sessionId: string;
  supabase: SupabaseClient<Database>;
  ticketId: string;
};

function deriveFileName(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/').trim();
  const segments = normalized.split('/');
  return segments[segments.length - 1] || normalized;
}

export async function insertFileChanges({
  changeRationales,
  checkpointId,
  eventId,
  sessionId,
  supabase,
  ticketId
}: InsertFileChangesInput): Promise<{ count: number; error: string | null }> {
  if (changeRationales.length === 0) {
    return { count: 0, error: null };
  }

  const rows: Database['public']['Tables']['file_changes']['Insert'][] = changeRationales.map(
    rationale => ({
      attribution_source: rationale.attribution_source ?? 'explicit',
      change_kind: rationale.change_kind ?? 'modify',
      confidence: rationale.confidence ?? 'explicit',
      checkpoint_id: checkpointId ?? null,
      event_id: eventId,
      file_name: deriveFileName(rationale.file_path),
      file_path: rationale.file_path,
      hunks: rationale.hunks ?? [],
      impact: rationale.impact,
      label: rationale.label,
      session_id: sessionId,
      summary: rationale.summary,
      ticket_id: ticketId,
      why: rationale.why
    })
  );

  const { error } = await supabase.from('file_changes').insert(rows);
  return {
    count: rows.length,
    error: error?.message ?? null
  };
}
