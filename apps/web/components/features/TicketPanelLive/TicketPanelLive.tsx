'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useTransition } from 'react';

import { CliQuickstart } from '@/components/features/CliQuickstart';
import { useTicketLive } from '@/components/features/TicketLiveProvider';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { markSessionDisconnectedAction } from '@/lib/actions/tickets';
import { getAgentTypeByIdentifier } from '@/lib/helpers/agent-types';
import { createClient } from '@/supabase/utils/client';

import { AgentSessionBadge } from './AgentSessionBadge';
import { LiveActivityFeed } from './LiveActivityFeed';
import { LiveArtifacts } from './LiveArtifacts';
import { LiveFileChanges } from './LiveFileChanges';
import { SharedStateSection } from './SharedStateSection';

type TicketPanelLiveProps = {
  ticketId: string;
  projectId: string;
  editorScheme: string;
  workspaceRoot: string;
  workingDirectory?: string | null;
  hasProjectWorkingDirectory?: boolean;
  agentToken?: string | null;
  claudeCommand?: string;
  codexCommand?: string;
  cursorCommand?: string;
  geminiCommand?: string;
  opencodeCommand?: string;
  claudeResumeCommand?: string;
  codexResumeCommand?: string;
  cursorResumeCommand?: string;
  geminiResumeCommand?: string;
  opencodeResumeCommand?: string;
};

export function TicketPanelLive({
  ticketId,
  editorScheme,
  workspaceRoot,
  claudeCommand: _claudeCommand,
  codexCommand: _codexCommand,
  cursorCommand: _cursorCommand,
  geminiCommand: _geminiCommand,
  opencodeCommand: _opencodeCommand,
  claudeResumeCommand: _claudeResumeCommand,
  codexResumeCommand: _codexResumeCommand,
  cursorResumeCommand: _cursorResumeCommand,
  geminiResumeCommand: _geminiResumeCommand,
  opencodeResumeCommand: _opencodeResumeCommand
}: TicketPanelLiveProps) {
  const router = useRouter();
  const { events, artifacts, fileChanges, session, sharedState } = useTicketLive();
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`ticket-status-refresh:${ticketId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'tickets', filter: `id=eq.${ticketId}` },
        () => {
          router.refresh();
        }
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [ticketId, router]);

  const isRunning = session?.session_state === 'attached';
  const activeAgentType = getAgentTypeByIdentifier(session?.agent_identifier ?? null);

  function handleForceDisconnect() {
    if (!session) return;
    startTransition(async () => {
      await markSessionDisconnectedAction(session.id);
    });
  }

  return (
    <>
      <CliQuickstart
        activeAgentValue={activeAgentType?.value}
        externalSessionId={session?.external_session_id}
        hasExecutedObjectives={events.length > 0}
        claudeCommand={_claudeCommand}
        codexCommand={_codexCommand}
        cursorCommand={_cursorCommand}
        geminiCommand={_geminiCommand}
        opencodeCommand={_opencodeCommand}
        claudeResumeCommand={_claudeResumeCommand}
        codexResumeCommand={_codexResumeCommand}
        cursorResumeCommand={_cursorResumeCommand}
        geminiResumeCommand={_geminiResumeCommand}
        opencodeResumeCommand={_opencodeResumeCommand}
      />
      <Separator className="mb-10" />

      <section className="mb-6">
        <div className="mb-4 flex items-center gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Activity
          </h2>
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
