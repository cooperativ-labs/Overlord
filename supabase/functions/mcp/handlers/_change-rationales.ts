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
    eventId: string;
    snapshot?: {
      backend?: string;
      jjChangeId?: string | null;
      jjCommitId?: string | null;
      jjOperationId?: string | null;
      workspaceName?: string | null;
      workspacePath?: string | null;
    };
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
      event_id: input.eventId,
      jj_change_id: rationale.jj_change_id ?? input.snapshot?.jjChangeId ?? null,
      jj_commit_id: rationale.jj_commit_id ?? input.snapshot?.jjCommitId ?? null,
      jj_operation_id: rationale.jj_operation_id ?? input.snapshot?.jjOperationId ?? null,
      file_name: deriveFileName(rationale.file_path),
      file_path: rationale.file_path,
      hunks: Array.isArray(rationale.hunks) ? rationale.hunks : [],
      impact: rationale.impact,
      label: rationale.label,
      snapshot_backend: rationale.snapshot_backend ?? input.snapshot?.backend ?? null,
      session_id: input.sessionId,
      summary: rationale.summary,
      ticket_id: input.ticketId,
      workspace_name: rationale.workspace_name ?? input.snapshot?.workspaceName ?? null,
      workspace_path: rationale.workspace_path ?? input.snapshot?.workspacePath ?? null,
      why: rationale.why
    }))
  );

  return {
    count: input.changeRationales.length,
    error: error?.message ?? null
  };
}
