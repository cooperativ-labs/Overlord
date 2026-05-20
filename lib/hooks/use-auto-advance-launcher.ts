'use client';

import { useEffect, useMemo, useRef } from 'react';
import { toast } from 'sonner';

import type { SidebarProject } from '@/lib/actions/project-types';
import { handleAutoAdvanceEvent } from '@/lib/auto-advance/handle-auto-advance-event';
import { createClient } from '@/supabase/utils/client';
import type { Database } from '@/types/database.types';
import type { LaunchTerminalAgentParams } from '@/types/electron';

type TicketEvent = Database['public']['Tables']['ticket_events']['Row'];

type UseAutoAdvanceLauncherOptions = {
  enabled: boolean;
  organizationId?: number;
  projects: SidebarProject[];
  launchAgent: (params: LaunchTerminalAgentParams) => Promise<void>;
};

function buildProjectDirectoryMap(projects: SidebarProject[]): Map<string, string | null> {
  return new Map(projects.map(project => [project.id, project.localWorkingDirectory]));
}

export function useAutoAdvanceLauncher({
  enabled,
  organizationId,
  projects,
  launchAgent
}: UseAutoAdvanceLauncherOptions): void {
  const processedEventIdsRef = useRef<Set<string>>(new Set());
  const inFlightKeysRef = useRef<Set<string>>(new Set());
  const launchAgentRef = useRef(launchAgent);
  const projectDirectoryMap = useMemo(() => buildProjectDirectoryMap(projects), [projects]);

  useEffect(() => {
    launchAgentRef.current = launchAgent;
  }, [launchAgent]);

  useEffect(() => {
    processedEventIdsRef.current = new Set();
    inFlightKeysRef.current = new Set();
  }, [organizationId]);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    const supabase = createClient();

    const runAutoAdvance = async (event: TicketEvent) => {
      if (cancelled) return;
      if (event.event_type !== 'auto_advance') return;
      if (processedEventIdsRef.current.has(event.id)) return;

      const objectiveId = event.objective_id;
      const inFlightKey = `${event.ticket_id}:${objectiveId ?? event.id}`;
      if (inFlightKeysRef.current.has(inFlightKey)) return;

      processedEventIdsRef.current.add(event.id);
      inFlightKeysRef.current.add(inFlightKey);
      if (processedEventIdsRef.current.size > 500) {
        processedEventIdsRef.current.clear();
      }

      try {
        const result = await handleAutoAdvanceEvent({
          event,
          launchAgent: launchAgentRef.current,
          localWorkingDirectoryByProjectId: projectDirectoryMap
        });

        if (!result.launched && result.reason !== 'session_already_active') {
          console.info('[auto-advance] Skipped launch:', result.reason, event.ticket_id);
        }
      } catch (error) {
        toast.error('Auto-advance failed to launch agent', {
          description:
            error instanceof Error && error.message.trim().length > 0
              ? error.message
              : 'Check your terminal settings and try running the next objective manually.'
        });
      } finally {
        inFlightKeysRef.current.delete(inFlightKey);
      }
    };

    const channel = supabase
      .channel(`auto-advance:${organizationId ?? 'all'}`)
      .on<TicketEvent>(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'ticket_events' },
        payload => {
          void runAutoAdvance(payload.new);
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [enabled, organizationId, projectDirectoryMap]);
}
