import { NextResponse } from 'next/server';

import { internalErrorResponse, parseProtocolBody } from '@/app/api/protocol/_lib';
import { findExecutionTargetByFingerprint } from '@/lib/overlord/execution-targets';
import { listProjectResourcesSchema } from '@/lib/overlord/validation';
import { createServiceRoleClient } from '@/supabase/utils/service-role';

export async function POST(request: Request) {
  const parsed = await parseProtocolBody(request, listProjectResourcesSchema);
  if (!parsed.ok) return parsed.errorResponse;

  try {
    const supabase = createServiceRoleClient();
    const { userId, organizationId } = parsed.tokenContext;
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
    }

    const { projectId, deviceFingerprint } = parsed.data;

    let executionTargetId: string | null = null;
    if (deviceFingerprint) {
      executionTargetId = await findExecutionTargetByFingerprint(supabase, {
        organizationId,
        userId,
        deviceFingerprint
      });
    }

    let query = (supabase as any)
      .from('project_resource_directories')
      .select(
        'id, directory_path, label, is_primary, execution_target_id, execution_targets(host, organization_execution_targets(label, organization_id))'
      )
      .eq('user_id', userId)
      .eq('project_id', projectId)
      .order('is_primary', { ascending: false })
      .order('created_at', { ascending: true });

    if (executionTargetId) {
      query = query.eq('execution_target_id', executionTargetId);
    }

    const { data, error } = await query;
    if (error) return internalErrorResponse(error);

    const resources = (data ?? []).map(
      (row: {
        id: string;
        directory_path: string;
        label: string | null;
        is_primary: boolean;
        execution_target_id: string;
        execution_targets:
          | {
              host: string | null;
              organization_execution_targets:
                | { label: string | null; organization_id: number }
                | { label: string | null; organization_id: number }[]
                | null;
            }
          | {
              host: string | null;
              organization_execution_targets:
                | { label: string | null; organization_id: number }
                | { label: string | null; organization_id: number }[]
                | null;
            }[]
          | null;
      }) => {
        const targetRel = row.execution_targets;
        const target = Array.isArray(targetRel) ? targetRel[0] : targetRel;
        const orgRel = target?.organization_execution_targets;
        const orgTargets = Array.isArray(orgRel) ? orgRel : [orgRel];
        const orgTarget =
          orgTargets.find(target => target?.organization_id === organizationId) ?? orgTargets[0];
        const deviceLabel = orgTarget?.label ?? null;
        const deviceHostname = target?.host ?? null;
        return {
          id: row.id,
          directoryPath: row.directory_path,
          label: row.label,
          isPrimary: row.is_primary,
          deviceId: row.execution_target_id,
          executionTargetId: row.execution_target_id,
          deviceLabel,
          deviceHostname
        };
      }
    );

    return NextResponse.json({ resources });
  } catch (error) {
    return internalErrorResponse(error);
  }
}
