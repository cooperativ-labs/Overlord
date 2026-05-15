'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useTransition } from 'react';

import { useTicketLive } from '@/components/features/TicketLiveProvider';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { markSessionDisconnectedAction } from '@/lib/actions/tickets';
import { reconcileRealtimeTicketRow } from '@/lib/client-data/tickets/cache';
import { withElectronActionRetry } from '@/lib/electron-auth/action-retry';
import { getAgentTypeByIdentifier } from '@/lib/helpers/agent-types';
import { createClient } from '@/supabase/utils/client';

const markSessionDisconnectedActionWithRetry = withElectronActionRetry(
  markSessionDisconnectedAction
);

import { AgentSessionBadge } from './AgentSessionBadge';
import { LiveActivityFeed } from './LiveActivityFeed';
import { LiveArtifacts } from './LiveArtifacts';
import { LiveFileChanges } from './LiveFileChanges';
import { SharedStateSection } from './SharedStateSection';

type TicketPanelLiveProps = {
  ticketId: string;
  projectId: string | null;
  editorScheme: string;
  workspaceRoot: string;
  workingDirectory?: string | null;
  hasProjectWorkingDirectory?: boolean;
};

export function TicketPanelLive({
  ticketId,
  projectId,
  editorScheme,
  workspaceRoot
}: TicketPanelLiveProps) {
  const queryClient = useQueryClient();
  const { events, artifacts, fileChanges, session, sharedState } = useTicketLive();
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`ticket-status-refresh:${ticketId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'tickets', filter: `id=eq.${ticketId}` },
        payload => {
          const updated = payload.new;
          reconcileRealtimeTicketRow(queryClient, {
            id: updated.id,
            status: updated.status ?? undefined,
            title: updated.title,
            is_read: updated.is_read,
            board_position: updated.board_position,
            updated_at: updated.updated_at,
            due_datetime: updated.due_datetime
          });
        }
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [queryClient, ticketId]);

  const isRunning = session?.session_state === 'attached';
  const activeAgentType = getAgentTypeByIdentifier(session?.agent_identifier ?? null);

  function handleForceDisconnect() {
    if (!session) return;
    startTransition(async () => {
      await markSessionDisconnectedActionWithRetry(session.id);
    });
  }

  return (
    <>
      <Separator className="mb-10" />
      <section className="mb-6">
        <div className="mb-4 flex items-center gap-2">
          <h2 className="eyebrow">Activity</h2>
          <AgentSessionBadge session={session} />
          {session?.external_url ? (
            <Button asChild className="h-5 px-2 text-[10px]" size="sm" variant="outline">
              <a href={session.external_url} target="_blank" rel="noreferrer">
                View in {activeAgentType?.label ?? 'agent'}
              </a>
            </Button>
          ) : null}
          {isRunning ? (
            <Button
              className="h-5 px-2 text-[10px]"
              disabled={isPending}
              size="sm"
              variant="ghost"
              onClick={handleForceDisconnect}
            >
              Force stop
            </Button>
          ) : null}
        </div>
        <LiveActivityFeed
          editorScheme={editorScheme}
          events={events}
          workspaceRoot={workspaceRoot}
        />
      </section>

      {(sharedState?.length ?? 0) > 0 || fileChanges.length > 0 || artifacts.length > 0 ? (
        <>
          <Separator className="mb-6" />
          <div className="grid gap-6">
            <SharedStateSection sharedState={sharedState ?? []} />
            <LiveFileChanges
              editorScheme={editorScheme}
              fileChanges={fileChanges}
              projectId={projectId}
              ticketId={ticketId}
              workspaceRoot={workspaceRoot}
            />
            <LiveArtifacts
              artifacts={artifacts}
              editorScheme={editorScheme}
              workspaceRoot={workspaceRoot}
            />
          </div>
        </>
      ) : null}
    </>
  );
}
