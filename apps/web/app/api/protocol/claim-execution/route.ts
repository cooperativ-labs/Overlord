import { NextResponse } from 'next/server';

import { internalErrorResponse, parseProtocolBody } from '@/app/api/protocol/_lib';
import {
  failActiveExecutionRequestsForObjective,
  isObjectiveLaunchableForExecution,
  loadObjectiveStatesById
} from '@/lib/overlord/execution-requests';
import { resolveTargetAgentLaunch } from '@/lib/overlord/target-agent-flags';
import { upsertDeviceFromProtocol } from '@/lib/overlord/upsert-device';
import { claimExecutionSchema } from '@/lib/overlord/validation';
import { createServiceRoleClient } from '@/supabase/utils/service-role';
import type { Database, Json } from '@/types/database.types';

type ExecutionRequestRow = Database['public']['Tables']['execution_requests']['Row'];

// Stored on `execution_requests.last_error` when a project request reaches claim
// without a primary directory on the claiming target (G4 backstop). Used to emit
// the ticket event only once per transition into the error so a runner polling
// every few seconds does not flood the activity feed.
const MISSING_PRIMARY_ERROR =
  'No primary resource directory is set for this project on this execution target.';

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

function jsonFromParams(params: Json, key: string): Json | null {
  if (!isRecord(params)) return null;
  const value = params[key];
  return typeof value === 'undefined' ? null : value;
}

async function resolveWorkingDirectory(
  supabase: ReturnType<typeof createServiceRoleClient>,
  request: ExecutionRequestRow,
  executionTargetId: string
): Promise<string | null> {
  const explicit = textFromParams(request.launch_params, 'workingDirectory');
  if (explicit) return explicit;

  if (request.target_resource_id) {
    // Resource directories are target-scoped, not per-user: a directory chosen on
    // a shared target may have been added by another user. Guard that it lives on
    // the claiming target AND (defense-in-depth for Finding #3) belongs to this
    // request's project — request creation already validates this, but the claim
    // path must not launch a foreign-project checkout if a bad row slips through.
    const { data } = await supabase
      .from('project_resource_directories')
      .select('directory_path, execution_target_id, project_id')
      .eq('id', request.target_resource_id)
      .maybeSingle();
    if (
      !data ||
      data.execution_target_id !== executionTargetId ||
      (request.project_id && data.project_id !== request.project_id)
    ) {
      return null;
    }
    return data.directory_path;
  }

  if (!request.project_id) return null;

  // Fall back to the (project, target) primary. Only the primary defines the
  // working directory; if there is none, return null so the caller can record a
  // missing-primary backstop event (G4) instead of launching in an arbitrary dir.
  const { data: targetResource } = await (supabase as any)
    .from('project_resource_directories')
    .select('directory_path')
    .eq('project_id', request.project_id)
    .eq('execution_target_id', executionTargetId)
    .eq('is_primary', true)
    .maybeSingle();
  return targetResource?.directory_path ?? null;
}

function claimableByStatus(row: ExecutionRequestRow, nowMs: number): boolean {
  if (row.status === 'queued') return true;
  // Phase 4: a stale `launching` row (runner spawned but the agent never
  // attached) is reclaimable for relaunch once its lease expires, same as a
  // stale `claimed` row.
  if (row.status !== 'claimed' && row.status !== 'launching') return false;
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

    // Org-agnostic claim (G3): the runner token identifies the *user*, not an
    // org. Claim queued work across every org the user is a member of that also
    // shares the claiming target. `organizationId` from the token is only a
    // default hint and is no longer used to scope the poll.
    const { data: memberRows } = await supabase
      .from('members')
      .select('organization_id')
      .eq('user_id', userId);
    const memberOrgIds = new Set((memberRows ?? []).map(row => row.organization_id));

    const { data: targetOrgRows } = await supabase
      .from('organization_execution_targets')
      .select('organization_id')
      .eq('execution_target_id', executionTargetId);
    const allowedOrgIds = [
      ...new Set(
        (targetOrgRows ?? []).map(row => row.organization_id).filter(id => memberOrgIds.has(id))
      )
    ];
    if (allowedOrgIds.length === 0) {
      return NextResponse.json({ request: null });
    }

    let query = supabase
      .from('execution_requests')
      .select('*')
      .in('organization_id', allowedOrgIds)
      .eq('requested_by', userId)
      .in('status', ['queued', 'claimed', 'launching'])
      .order('created_at', { ascending: true })
      .limit(25);
    if (projectId) query = query.eq('project_id', projectId);

    const { data: candidates, error } = await query;
    if (error) return internalErrorResponse(error);

    const objectiveStates = await loadObjectiveStatesById(
      supabase,
      (candidates ?? []).map(candidate => candidate.objective_id)
    );

    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + leaseSeconds * 1000).toISOString();
    for (const candidate of candidates ?? []) {
      const objectiveState = objectiveStates.get(candidate.objective_id);
      if (!objectiveState || !isObjectiveLaunchableForExecution(objectiveState)) {
        await failActiveExecutionRequestsForObjective({
          supabase,
          organizationId: candidate.organization_id,
          objectiveId: candidate.objective_id,
          requestedBy: userId
        }).catch(err => {
          console.error('[claim-execution] failed to cancel stale execution request', {
            executionRequestId: candidate.id,
            objectiveId: candidate.objective_id,
            error: err instanceof Error ? err.message : err
          });
        });
        continue;
      }

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
        executionTargetId
      );
      if (candidate.target_kind === 'ssh' && !sshCommand) continue;
      if (candidate.project_id && !workingDirectory && !sshCommand) {
        // Fail-closed backstop to G4: a project request reached claim with no
        // primary directory on this target. Leave it queued for retry and record
        // the missing primary instead of silently skipping it. Only emit the
        // ticket event on the transition into the error (tracked via
        // `last_error`) so a runner polling every few seconds does not flood the
        // activity feed with duplicates. `last_error` is cleared when the request
        // is later claimed, so a recurrence re-notifies.
        if (candidate.last_error !== MISSING_PRIMARY_ERROR) {
          await supabase
            .from('execution_requests')
            .update({ last_error: MISSING_PRIMARY_ERROR })
            .eq('id', candidate.id);
          await supabase.from('ticket_events').insert({
            event_type: 'system',
            phase: 'execute',
            summary: MISSING_PRIMARY_ERROR,
            ticket_id: candidate.ticket_id,
            objective_id: candidate.objective_id,
            created_by: userId,
            payload: {
              execution_request_id: candidate.id,
              execution_target_id: executionTargetId,
              project_id: candidate.project_id,
              missing_primary: true
            }
          });
        }
        continue;
      }

      // Resolve the per-target agent config BEFORE claiming so a transient
      // config-lookup failure cannot leave the request leased without a launch
      // payload. Per-target local agent config wins over the flags/pre-command
      // captured in launch_params (which come from the user's global agent
      // config at request time), since the claiming target may differ from
      // where the request was made.
      const targetLaunch = await resolveTargetAgentLaunch(
        supabase,
        userId,
        executionTargetId,
        candidate.agent_identifier
      );
      if (targetLaunch.kind === 'error') {
        // Fail closed: do NOT fall back to request-captured flags on a genuine
        // lookup error. Leave the request queued so it can be retried, record
        // the failure for the UI/observability, and skip this candidate.
        console.error('[claim-execution] target agent config lookup failed', {
          executionRequestId: candidate.id,
          executionTargetId,
          agent: candidate.agent_identifier,
          error: targetLaunch.error
        });
        await supabase.from('ticket_events').insert({
          event_type: 'system',
          phase: 'execute',
          summary: 'Could not load the execution target launch configuration; retrying.',
          ticket_id: candidate.ticket_id,
          objective_id: candidate.objective_id,
          created_by: userId,
          payload: {
            execution_request_id: candidate.id,
            execution_target_id: executionTargetId,
            agent_identifier: candidate.agent_identifier,
            target_config_error: targetLaunch.error
          }
        });
        continue;
      }

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
        candidate.status === 'claimed' || candidate.status === 'launching'
          ? claimUpdate.eq('status', candidate.status).lt('lease_expires_at', now.toISOString())
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
          flags:
            targetLaunch.kind === 'configured'
              ? targetLaunch.flags
              : stringArrayFromParams(claimed.launch_params, 'flags'),
          preCommand:
            targetLaunch.kind === 'configured'
              ? targetLaunch.preCommand
              : textFromParams(claimed.launch_params, 'preCommand'),
          customCommand: textFromParams(claimed.launch_params, 'customCommand'),
          workingDirectory,
          sshCommand,
          remoteWorkingDirectory: textFromParams(claimed.launch_params, 'remoteWorkingDirectory'),
          serverMultiplexer: textFromParams(claimed.launch_params, 'serverMultiplexer'),
          tmuxCommand: textFromParams(claimed.launch_params, 'tmuxCommand'),
          runnerTerminalProfile: jsonFromParams(claimed.launch_params, 'runnerTerminalProfile')
        }
      });
    }

    return NextResponse.json({ request: null });
  } catch (error) {
    return internalErrorResponse(error);
  }
}
