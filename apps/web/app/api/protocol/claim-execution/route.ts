import { NextResponse } from 'next/server';

import { internalErrorResponse, parseProtocolBody } from '@/app/api/protocol/_lib';
import { upsertDeviceFromProtocol } from '@/lib/overlord/upsert-device';
import { claimExecutionSchema } from '@/lib/overlord/validation';
import { createServiceRoleClient } from '@/supabase/utils/service-role';
import type { Database, Json } from '@/types/database.types';

type ExecutionRequestRow = Database['public']['Tables']['execution_requests']['Row'];

function isRecord(value: Json): value is Record<string, Json | undefined> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function textFromParams(params: Json, key: string): string | null {
  if (!isRecord(params)) return null;
  const value = params[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function stringArrayFromParams(params: Json, key: string): string[] {
  if (!isRecord(params)) return [];
  const value = params[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

async function resolveWorkingDirectory(
  supabase: ReturnType<typeof createServiceRoleClient>,
  request: ExecutionRequestRow,
  userId: string,
  executionTargetId: string
): Promise<string | null> {
  const explicit = textFromParams(request.launch_params, 'workingDirectory');
  if (explicit) return explicit;

  if (request.target_resource_id) {
    const { data } = await supabase
      .from('project_resource_directories')
      .select('directory_path, execution_target_id, user_id')
      .eq('id', request.target_resource_id)
      .maybeSingle();
    if (!data || data.user_id !== userId || data.execution_target_id !== executionTargetId) {
      return null;
    }
    return data.directory_path;
  }

  if (!request.project_id) return null;

  const { data: targetResource } = await (supabase as any)
    .from('project_resource_directories')
    .select('directory_path')
    .eq('project_id', request.project_id)
    .eq('execution_target_id', executionTargetId)
    .order('is_primary', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  return targetResource?.directory_path ?? null;
}

function claimableByStatus(row: ExecutionRequestRow, nowMs: number): boolean {
  if (row.status === 'queued') return true;
  if (row.status !== 'claimed') return false;
  if (!row.lease_expires_at) return true;
  return Date.parse(row.lease_expires_at) < nowMs;
}

export async function POST(request: Request) {
  const parsed = await parseProtocolBody(request, claimExecutionSchema);
  if (!parsed.ok) return parsed.errorResponse;

  try {
    const supabase = createServiceRoleClient();
    const { organizationId, userId } = parsed.tokenContext;
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
    }

    const { deviceFingerprint, deviceHostname, devicePlatform, leaseSeconds, projectId } =
      parsed.data;
    const executionTargetId = await upsertDeviceFromProtocol(supabase, {
      organizationId,
      userId,
      deviceFingerprint,
      hostname: deviceHostname ?? null,
      platform: devicePlatform ?? null
    });
    if (!executionTargetId) {
      return NextResponse.json({ error: 'Failed to register execution target.' }, { status: 500 });
    }

    let query = supabase
      .from('execution_requests')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('requested_by', userId)
      .in('status', ['queued', 'claimed'])
      .order('created_at', { ascending: true })
      .limit(25);
    if (projectId) query = query.eq('project_id', projectId);

    const { data: candidates, error } = await query;
    if (error) return internalErrorResponse(error);

    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + leaseSeconds * 1000).toISOString();
    for (const candidate of candidates ?? []) {
      if (!claimableByStatus(candidate, now.getTime())) continue;
      if (
        candidate.target_execution_target_id &&
        candidate.target_execution_target_id !== executionTargetId
      ) {
        continue;
      }

      const sshCommand = textFromParams(candidate.launch_params, 'sshCommand');
      const workingDirectory = await resolveWorkingDirectory(
        supabase,
        candidate,
        userId,
        executionTargetId
      );
      if (candidate.target_kind === 'ssh' && !sshCommand) continue;
      if (candidate.project_id && !workingDirectory && !sshCommand) continue;

      let claimUpdate = supabase
        .from('execution_requests')
        .update({
          status: 'claimed',
          claimed_by_execution_target_id: executionTargetId,
          claimed_at: now.toISOString(),
          lease_expires_at: leaseExpiresAt,
          last_error: null,
          attempt_count: candidate.attempt_count + 1
        })
        .eq('id', candidate.id)
        .select('*');

      claimUpdate =
        candidate.status === 'claimed'
          ? claimUpdate.eq('status', 'claimed').lt('lease_expires_at', now.toISOString())
          : claimUpdate.eq('status', 'queued');

      const { data: claimed, error: claimError } = await claimUpdate.maybeSingle();

      if (claimError || !claimed) continue;

      const { data: ticket } = await supabase
        .from('tickets')
        .select('id,ticket_id,project_id')
        .eq('id', claimed.ticket_id)
        .single();

      return NextResponse.json({
        request: claimed,
        launch: {
          ticketId: ticket?.ticket_id ?? claimed.ticket_id,
          agent: claimed.agent_identifier,
          model: claimed.model_identifier,
          thinking: claimed.thinking_level,
          launchMode: claimed.launch_mode,
          flags: stringArrayFromParams(claimed.launch_params, 'flags'),
          preCommand: textFromParams(claimed.launch_params, 'preCommand'),
          customCommand: textFromParams(claimed.launch_params, 'customCommand'),
          workingDirectory,
          sshCommand,
          remoteWorkingDirectory: textFromParams(claimed.launch_params, 'remoteWorkingDirectory'),
          serverMultiplexer: textFromParams(claimed.launch_params, 'serverMultiplexer'),
          tmuxCommand: textFromParams(claimed.launch_params, 'tmuxCommand')
        }
      });
    }

    return NextResponse.json({ request: null });
  } catch (error) {
    return internalErrorResponse(error);
  }
}
