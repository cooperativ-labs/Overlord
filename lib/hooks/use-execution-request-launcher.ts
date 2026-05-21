'use client';

import { useEffect, useRef } from 'react';
import { toast } from 'sonner';

import { isLaunchAgentTypeValue, type LaunchAgentType } from '@/lib/helpers/agent-types';
import { createClient } from '@/supabase/utils/client';
import type { Database } from '@/types/database.types';
import type { LaunchTerminalAgentParams } from '@/types/electron';

type TicketEvent = Database['public']['Tables']['ticket_events']['Row'];

type ClaimedLaunchParams = {
  ticketId: string;
  agent: string;
  model: string | null;
  thinking: string | null;
  launchMode: 'run' | 'ask';
  flags: string[];
  workingDirectory: string | null;
  sshCommand: string | null;
  remoteWorkingDirectory: string | null;
  serverMultiplexer: string | null;
  tmuxCommand: string | null;
};

type ClaimResponse = {
  request:
    | {
        id: string;
        ticket_id: string;
        project_id: string | null;
        organization_id: number;
      }
    | null;
  launch?: ClaimedLaunchParams;
};

type UseExecutionRequestLauncherOptions = {
  enabled: boolean;
  organizationId?: number;
  launchAgent: (params: LaunchTerminalAgentParams) => Promise<void>;
};

const POLL_INTERVAL_MS = 8_000;
const MAX_CLAIMS_PER_TICK = 5;

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

export function useExecutionRequestLauncher({
  enabled,
  organizationId,
  launchAgent
}: UseExecutionRequestLauncherOptions): void {
  const launchAgentRef = useRef(launchAgent);
  useEffect(() => {
    launchAgentRef.current = launchAgent;
  }, [launchAgent]);

  useEffect(() => {
    if (!enabled || !organizationId) return;
    if (typeof window === 'undefined' || !window.electronAPI) return;

    let cancelled = false;
    let inFlight = false;
    let identity: { deviceFingerprint: string; hostname: string; platform: string } | null = null;

    const ensureIdentity = async () => {
      if (identity) return identity;
      const value = await window.electronAPI?.app?.getDeviceIdentity?.();
      if (value) identity = value;
      return identity;
    };

    const claimAndLaunch = async (): Promise<void> => {
      if (cancelled || inFlight) return;
      const id = await ensureIdentity();
      if (!id) return;
      inFlight = true;
      try {
        for (let i = 0; i < MAX_CLAIMS_PER_TICK; i++) {
          if (cancelled) return;
          let claim: ClaimResponse;
          try {
            claim = await protocolFetch<ClaimResponse>(
              'claim-execution',
              {
                deviceFingerprint: id.deviceFingerprint,
                deviceHostname: id.hostname,
                devicePlatform: id.platform
              },
              organizationId
            );
          } catch (error) {
            console.error('[execution-request-launcher] claim failed:', error);
            return;
          }
          if (!claim.request || !claim.launch) return;

          const requestId = claim.request.id;
          const launch = claim.launch;

          try {
            await launchAgentRef.current({
              ticketId: launch.ticketId,
              agent: normalizeLaunchAgent(launch.agent),
              organizationId,
              projectId: claim.request.project_id ?? undefined,
              cwd: launch.workingDirectory ?? undefined,
              sshCommand: launch.sshCommand ?? undefined,
              remoteWorkingDirectory: launch.remoteWorkingDirectory ?? undefined,
              launchMode: launch.launchMode,
              flags: launch.flags,
              model: launch.model ?? undefined,
              thinking: launch.thinking ?? undefined
            });
            await protocolFetch(
              'complete-execution-launch',
              { requestId, deviceFingerprint: id.deviceFingerprint },
              organizationId
            ).catch(error => {
              console.error('[execution-request-launcher] complete failed:', error);
            });
            void window.electronAPI?.app?.notify(
              'Launching next objective',
              `Started ${launch.agent} for ${launch.ticketId}`
            );
          } catch (error) {
            const message =
              error instanceof Error && error.message.trim().length > 0
                ? error.message
                : 'Failed to launch agent.';
            await protocolFetch(
              'fail-execution-launch',
              {
                requestId,
                deviceFingerprint: id.deviceFingerprint,
                error: message
              },
              organizationId
            ).catch(() => undefined);
            toast.error('Failed to launch queued execution', { description: message });
            return;
          }
        }
      } finally {
        inFlight = false;
      }
    };

    const supabase = createClient();
    const channel = supabase
      .channel(`execution-requests:${organizationId}`)
      .on<TicketEvent>(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'ticket_events' },
        payload => {
          if (payload.new.event_type !== 'execution_requested') return;
          void claimAndLaunch();
        }
      )
      .subscribe();

    void claimAndLaunch();
    const poll = window.setInterval(() => void claimAndLaunch(), POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(poll);
      void supabase.removeChannel(channel);
    };
  }, [enabled, organizationId, launchAgent]);
}
