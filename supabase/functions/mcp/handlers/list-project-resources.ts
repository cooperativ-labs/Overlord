/// <reference lib="deno.ns" />
// deno-lint-ignore-file no-explicit-any
import { type SupabaseClient } from '@supabase/supabase-js';

import { type TokenContext } from '../auth.ts';
import { toolErr, toolOk } from '../rpc.ts';

export async function handleListProjectResources(
  supabase: SupabaseClient,
  args: any,
  ctx: TokenContext
) {
  const projectId = typeof args?.projectId === 'string' ? args.projectId.trim() : '';
  if (!projectId) return toolErr('projectId is required.');
  if (!ctx.userId) return toolErr('Authentication required.');

  const deviceFingerprint =
    typeof args?.deviceFingerprint === 'string' ? args.deviceFingerprint.trim() : '';

  let executionTargetId: string | null = null;
  if (deviceFingerprint) {
    const { data: target } = await supabase
      .from('execution_targets')
      .select('id')
      .eq('device_fingerprint', deviceFingerprint)
      .maybeSingle();
    executionTargetId = (target as any)?.id ?? null;
  }

  let query = supabase
    .from('project_resource_directories')
    .select(
      'id, directory_path, label, is_primary, execution_target_id, execution_targets(host, organization_execution_targets(label, organization_id))'
    )
    .eq('user_id', ctx.userId)
    .eq('project_id', projectId)
    .order('is_primary', { ascending: false })
    .order('created_at', { ascending: true });

  if (executionTargetId) {
    query = (query as any).eq('execution_target_id', executionTargetId);
  }

  const { data, error } = await query;
  if (error) return toolErr(`Failed to list resources: ${error.message}`);

  const resources = (data ?? []).map((row: any) => {
    const targetRel = row.execution_targets;
    const target = Array.isArray(targetRel) ? targetRel[0] : targetRel;
    const orgRel = target?.organization_execution_targets;
    const orgTargets = Array.isArray(orgRel) ? orgRel : [orgRel];
    const orgTarget =
      orgTargets.find((target: any) => target?.organization_id === ctx.organizationId) ??
      orgTargets[0];
    const deviceLabel = orgTarget?.label ?? null;
    const deviceHostname = target?.host ?? null;
    return {
      id: row.id,
      directoryPath: row.directory_path,
      label: row.label ?? null,
      isPrimary: row.is_primary,
      deviceId: row.execution_target_id ?? null,
      executionTargetId: row.execution_target_id ?? null,
      deviceLabel,
      deviceHostname
    };
  });

  return toolOk({ resources });
}
