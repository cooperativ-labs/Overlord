import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database, Json } from '@/types/database.types';

export type FileChangeInput = {
  attribution_source?: string;
  change_kind?: string;
  confidence?: string;
  jj_change_id?: string | null;
  jj_commit_id?: string | null;
  jj_operation_id?: string | null;
  file_path: string;
  hunks?: Json;
  impact: string;
  label: string;
  snapshot_backend?: string | null;
  summary: string;
  workspace_name?: string | null;
  workspace_path?: string | null;
  why: string;
};

type InsertFileChangesInput = {
  changeRationales: FileChangeInput[];
  eventId: string;
  sessionId: string;
  snapshot?: {
    backend?: string;
    jjChangeId?: string | null;
    jjCommitId?: string | null;
    jjOperationId?: string | null;
    workspaceName?: string | null;
    workspacePath?: string | null;
  };
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
  eventId,
  sessionId,
  snapshot,
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
      event_id: eventId,
      jj_change_id: rationale.jj_change_id ?? snapshot?.jjChangeId ?? null,
      jj_commit_id: rationale.jj_commit_id ?? snapshot?.jjCommitId ?? null,
      jj_operation_id: rationale.jj_operation_id ?? snapshot?.jjOperationId ?? null,
      file_name: deriveFileName(rationale.file_path),
      file_path: rationale.file_path,
      hunks: rationale.hunks ?? [],
      impact: rationale.impact,
      label: rationale.label,
      snapshot_backend: rationale.snapshot_backend ?? snapshot?.backend ?? null,
      session_id: sessionId,
      summary: rationale.summary,
      ticket_id: ticketId,
      workspace_name: rationale.workspace_name ?? snapshot?.workspaceName ?? null,
      workspace_path: rationale.workspace_path ?? snapshot?.workspacePath ?? null,
      why: rationale.why
    })
  );

  const { error } = await supabase.from('file_changes').insert(rows);
  return {
    count: rows.length,
    error: error?.message ?? null
  };
}
