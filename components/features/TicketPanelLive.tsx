'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useTransition } from 'react';

import { FileChangesArtifact } from '@/components/features/FileChangesArtifact';
import { LaunchCommandBar } from '@/components/features/LaunchCommandBar';
import { MarkdownContent } from '@/components/features/MarkdownContent';
import { useTicketLive } from '@/components/features/TicketLiveProvider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { markSessionDisconnectedAction } from '@/lib/actions/tickets';
import { getConversationEntryType } from '@/lib/overlord/conversation';
import { createClient } from '@/supabase/utils/client';
import type { Database } from '@/types/database.types';

type TicketEvent = Database['public']['Tables']['ticket_events']['Row'];
type Artifact = Database['public']['Tables']['artifacts']['Row'];
type AgentSession = Database['public']['Tables']['agent_sessions']['Row'];
type SessionState = Database['public']['Enums']['session_state'];

// --- AgentSessionBadge ---

const sessionBadgeConfig: Record<
  SessionState,
  { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; pulse?: boolean }
> = {
  attached: { label: 'Running', variant: 'default', pulse: true },
  idle: { label: 'Idle', variant: 'secondary' },
  blocked: { label: 'Blocked', variant: 'destructive' },
  completed: { label: 'Completed', variant: 'outline' },
  disconnected: { label: 'Disconnected', variant: 'destructive' }
};

export function AgentSessionBadge({ session }: { session: AgentSession | null }) {
  if (!session) return null;

  const config = sessionBadgeConfig[session.session_state] ?? {
    label: session.session_state,
    variant: 'outline' as const
  };

  return (
    <Badge className="rounded-full gap-1.5" variant={config.variant}>
      {config.pulse && (
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-current" />
        </span>
      )}
      {config.label}
    </Badge>
  );
}

// --- LiveActivityFeed ---

function LiveActivityFeed({ events }: { events: TicketEvent[] }) {
  const visibleEvents = events.filter(event => event.event_type !== 'system');

  if (!visibleEvents.length) {
    return <p className="text-sm italic text-muted-foreground">No events yet.</p>;
  }

  function getEventLabel(event: TicketEvent): string {
    const entryType = getConversationEntryType(event);
    if (entryType === 'follow_up') return 'follow_up';
    if (entryType === 'answer') return 'answer';
    if (event.event_type === 'alert') return 'notification';
    return event.event_type;
  }

  return (
    <div className="grid gap-3">
      {visibleEvents.map(event => (
        <article className="flex gap-3" key={event.id}>
          <div className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-muted-foreground/30" />
          <div className="grid gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium">{getEventLabel(event)}</span>
              {event.phase ? (
                <Badge className="h-5 rounded-full px-2 text-xs" variant="secondary">
                  {event.phase}
                </Badge>
              ) : null}
              <span className="text-xs text-muted-foreground">
                {new Date(event.created_at).toLocaleString()}
              </span>
            </div>
            {event.summary ? (
              <MarkdownContent compact className="text-sm text-muted-foreground">
                {event.summary}
              </MarkdownContent>
            ) : (
              <p className="text-sm italic text-muted-foreground">No summary.</p>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}

// --- LiveArtifacts ---

function LiveArtifacts({
  artifacts,
  editorScheme,
  workspaceRoot
}: {
  artifacts: Artifact[];
  editorScheme: string;
  workspaceRoot: string;
}) {
  if (!artifacts.length) return null;

  return (
    <section>
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        Artifacts
      </h2>
      <div className="grid gap-4">
        {artifacts.map(artifact => (
          <div key={artifact.id}>
            <p className="mb-0.5 text-xs font-medium">{artifact.label}</p>
            <p className="mb-1 text-xs text-muted-foreground">{artifact.artifact_type}</p>
            {artifact.uri ? (
              <a
                className="text-xs text-primary underline-offset-4 hover:underline"
                href={artifact.uri}
              >
                {artifact.uri}
              </a>
            ) : null}
            {artifact.content ? (
              artifact.artifact_type === 'file_changes' ? (
                <FileChangesArtifact
                  content={artifact.content}
                  editorScheme={editorScheme}
                  workspaceRoot={workspaceRoot}
                />
              ) : (
                <MarkdownContent compact className="mt-1 text-xs text-muted-foreground">
                  {artifact.content}
                </MarkdownContent>
              )
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}

// --- Main Composite Component ---

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
};

export function TicketPanelLive({
  ticketId,
  projectId: _projectId,
  editorScheme,
  workspaceRoot,
  workingDirectory,
  hasProjectWorkingDirectory,
  agentToken,
  claudeCommand,
  codexCommand,
  cursorCommand,
  geminiCommand
}: TicketPanelLiveProps) {
  const router = useRouter();
  const { events, artifacts, session, sharedState } = useTicketLive();
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
  const activeAgentIdentifier = isRunning ? session.agent_identifier : null;

  function handleForceDisconnect() {
    if (!session) return;
    startTransition(async () => {
      await markSessionDisconnectedAction(session.id);
    });
  }

  return (
    <>
      {/* {claudeCommand && codexCommand && cursorCommand && geminiCommand ? (
        <LaunchCommandBar
          className="mb-6 border-primary/25 bg-background/80"
          ticketId={ticketId}
          agentToken={agentToken}
          claudeCommand={claudeCommand}
          codexCommand={codexCommand}
          cursorCommand={cursorCommand}
          geminiCommand={geminiCommand}
          workingDirectory={workingDirectory}
          activeAgentIdentifier={activeAgentIdentifier}
          hasProjectWorkingDirectory={hasProjectWorkingDirectory}
          agentSessionState={session?.session_state ?? null}
        />
      ) : null} */}

      {/* <TicketConversationComposer ticketId={ticketId} projectId={projectId} events={events} /> */}

      <section className="mb-6">
        <div className="mb-4 flex items-center gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Activity
          </h2>
          <AgentSessionBadge session={session} />
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
        <LiveActivityFeed events={events} />
      </section>

      {(sharedState?.length ?? 0) > 0 || artifacts.length > 0 ? (
        <>
          <Separator className="mb-6" />
          <div className="grid gap-6">
            {(sharedState?.length ?? 0) > 0 ? (
              <section>
                <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  Shared State
                </h2>
                <div className="grid gap-3">
                  {sharedState.map(item => (
                    <div key={item.id}>
                      <p className="mb-1 text-xs font-medium">{item.state_key}</p>
                      <code className="block max-h-32 overflow-auto rounded border bg-muted p-2 text-xs">
                        {JSON.stringify(item.state_value, null, 2)}
                      </code>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
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
