'use client';

import { isLaunchAgentTypeValue, type LaunchAgentType } from '@/lib/helpers/agent-types';
import type { LaunchTerminalAgentParams } from '@/types/electron';

type ClaimedLaunchParams = {
  ticketId: string;
  agent: string;
  model: string | null;
  thinking: string | null;
  launchMode: 'run' | 'ask';
  flags: string[];
  preCommand: string | null;
  customCommand: string | null;
  workingDirectory: string | null;
  sshCommand: string | null;
  remoteWorkingDirectory: string | null;
  serverMultiplexer: string | null;
  tmuxCommand: string | null;
};

type ClaimResponse = {
  request: {
    id: string;
    ticket_id: string;
    project_id: string | null;
    organization_id: number;
  } | null;
  launch?: ClaimedLaunchParams;
};

type LaunchQueuedExecutionOptions = {
  launchAgent: (params: LaunchTerminalAgentParams) => Promise<void>;
  maxClaims?: number;
  organizationId: number;
  requestId?: string;
};

async function protocolFetch<T>(
  endpoint: string,
  body: object,
  organizationId: number
): Promise<T> {
  const accessTokenResult = await window.electronAPI?.auth?.getAccessToken();
  if (!accessTokenResult?.ok || !accessTokenResult.accessToken) {
    throw new Error('Missing access token for protocol request.');
  }

  const response = await fetch(`/api/protocol/${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessTokenResult.accessToken}`,
      'x-organization-id': String(organizationId)
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`POST /api/protocol/${endpoint} ${response.status}: ${text}`);
  }

  return (await response.json()) as T;
}

function normalizeLaunchAgent(value: string): LaunchAgentType {
  return isLaunchAgentTypeValue(value) ? value : 'claude';
}

export async function claimAndLaunchQueuedExecutions({
  launchAgent,
  maxClaims = 1,
  organizationId,
  requestId
}: LaunchQueuedExecutionOptions): Promise<number> {
  const identity = await window.electronAPI?.app?.getDeviceIdentity?.();
  if (!identity) return 0;

  let launchedCount = 0;
  for (let i = 0; i < maxClaims; i++) {
    const claim = await protocolFetch<ClaimResponse>(
      'claim-execution',
      {
        deviceFingerprint: identity.deviceFingerprint,
        deviceHostname: identity.hostname,
        devicePlatform: identity.platform,
        ...(requestId ? { requestId } : {})
      },
      organizationId
    );

    if (!claim.request || !claim.launch) return launchedCount;

    const launch = claim.launch;
    try {
      await launchAgent({
        ticketId: launch.ticketId,
        agent: normalizeLaunchAgent(launch.agent),
        organizationId,
        projectId: claim.request.project_id ?? undefined,
        cwd: launch.workingDirectory ?? undefined,
        sshCommand: launch.sshCommand ?? undefined,
        remoteWorkingDirectory: launch.remoteWorkingDirectory ?? undefined,
        launchMode: launch.launchMode,
        flags: launch.flags,
        preCommand: launch.preCommand ?? undefined,
        customCommand: launch.customCommand ?? undefined,
        model: launch.model ?? undefined,
        thinking: launch.thinking ?? undefined
      });

      await protocolFetch(
        'complete-execution-launch',
        {
          requestId: claim.request.id,
          deviceFingerprint: identity.deviceFingerprint
        },
        organizationId
      );
      launchedCount += 1;
    } catch (error) {
      const message =
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : 'Failed to launch agent.';
      await protocolFetch(
        'fail-execution-launch',
        {
          requestId: claim.request.id,
          deviceFingerprint: identity.deviceFingerprint,
          error: message
        },
        organizationId
      ).catch(() => undefined);
      throw error;
    }

    if (requestId) return launchedCount;
  }

  return launchedCount;
}
