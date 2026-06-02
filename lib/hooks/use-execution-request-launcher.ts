'use client';

import { useEffect, useRef } from 'react';
import { toast } from 'sonner';

import { claimAndLaunchQueuedExecutions } from '@/lib/electron/queued-execution-launch';
import { createClient } from '@/supabase/utils/client';
import type { Database } from '@/types/database.types';
import type { LaunchTerminalAgentParams } from '@/types/electron';

type TicketEvent = Database['public']['Tables']['ticket_events']['Row'];

type UseExecutionRequestLauncherOptions = {
  enabled: boolean;
  organizationId?: number;
  launchAgent: (params: LaunchTerminalAgentParams) => Promise<void>;
};

const POLL_INTERVAL_MS = 8_000;
const MAX_CLAIMS_PER_TICK = 5;

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

    const claimAndLaunch = async (): Promise<void> => {
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        const launchedCount = await claimAndLaunchQueuedExecutions({
          organizationId,
          launchAgent: launchAgentRef.current,
          maxClaims: MAX_CLAIMS_PER_TICK
        });
        if (launchedCount > 0) {
          void window.electronAPI?.app?.notify(
            'Launching next objective',
            `Started ${launchedCount === 1 ? '1 queued execution' : `${launchedCount} queued executions`}`
          );
        }
      } catch (error) {
        console.error('[execution-request-launcher] claim failed:', error);
        const message =
          error instanceof Error && error.message.trim().length > 0
            ? error.message
            : 'Failed to launch queued execution.';
        toast.error('Failed to launch queued execution', { description: message });
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
