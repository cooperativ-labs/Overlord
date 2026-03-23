'use client';

import { FileCode2 } from 'lucide-react';
import { MessageSquare } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useTransition } from 'react';

import { CliQuickstart } from '@/components/features/CliQuickstart';
import { MarkdownContent } from '@/components/features/MarkdownContent';
import { useTicketLive } from '@/components/features/TicketLiveProvider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { markSessionDisconnectedAction } from '@/lib/actions/tickets';
import { getAgentTypeByIdentifier } from '@/lib/helpers/agent-types';
import { buildDiffHref } from '@/lib/helpers/file-changes';
import {
  getEventDisplayLabel,
  getEventDisplaySummary,
  isUserFollowUpEvent
} from '@/lib/overlord/conversation';
import { cn } from '@/lib/utils';
import { createClient } from '@/supabase/utils/client';
import type { Database } from '@/types/database.types';

type TicketEvent = Database['public']['Tables']['ticket_events']['Row'];
type Artifact = Database['public']['Tables']['artifacts']['Row'];
type AgentSession = Database['public']['Tables']['agent_sessions']['Row'];
type FileChange = Database['public']['Tables']['file_changes']['Row'];
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

  return (
    <div className="grid gap-3">
      {visibleEvents.map(event => {
        const isUserFollowUp = isUserFollowUpEvent(event);
        const summary = getEventDisplaySummary(event);

        return (
          <article className="flex gap-3" key={event.id}>
            <div
              className={cn(
                'mt-1.5 h-2 w-2 shrink-0 rounded-full',
                isUserFollowUp ? 'bg-sky-500/80' : 'bg-muted-foreground/30'
              )}
            />
            <div className="grid gap-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    'inline-flex items-center gap-1.5 text-xs font-medium',
                    isUserFollowUp && 'text-sky-700 dark:text-sky-400'
                  )}
                >
                  {isUserFollowUp ? <MessageSquare className="h-3.5 w-3.5" /> : null}
                  {getEventDisplayLabel(event)}
                </span>
                {event.phase ? (
                  <Badge className="h-5 rounded-full px-2 text-xs" variant="secondary">
                    {event.phase}
                  </Badge>
                ) : null}
                <span className="text-xs text-muted-foreground">
                  {new Date(event.created_at).toLocaleString()}
                </span>
              </div>
              {summary ? (
                <MarkdownContent
                  compact
                  className={cn(
                    'text-sm',
                    isUserFollowUp
                      ? [
                          'text-sky-700 dark:text-sky-300',
                          'prose-p:text-sky-700 dark:prose-p:text-sky-300',
                          'prose-li:text-sky-700 dark:prose-li:text-sky-300',
                          'prose-strong:text-sky-800 dark:prose-strong:text-sky-200',
                          'prose-code:text-sky-800 dark:prose-code:text-sky-200'
                        ]
                      : 'text-muted-foreground'
                  )}
                >
                  {summary}
                </MarkdownContent>
              ) : (
                <p className="text-sm italic text-muted-foreground">No summary.</p>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}

// --- LiveArtifacts ---

function LiveFileChangeCard({
  editorScheme,
  fileChange,
  workspaceRoot
}: {
  editorScheme: string;
  fileChange: FileChange;
  workspaceRoot: string;
}) {
  const href = workspaceRoot
    ? buildDiffHref(fileChange.file_path, workspaceRoot, editorScheme)
    : undefined;

  return (
    <article className="rounded-lg border bg-muted/20 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="mb-1 text-xs font-medium break-words">File change</p>
          <p className="mb-1 text-xs text-muted-foreground">file_change</p>
          {href ? (
            <a
              className="inline-flex items-center gap-2 text-sm font-medium text-primary underline-offset-4 hover:underline"
              href={href}
              title={`Open ${fileChange.file_path} in your editor`}
            >
              <FileCode2 className="h-4 w-4" />
              <span className="truncate">{fileChange.file_name}</span>
            </a>
          ) : (
            <div className="inline-flex items-center gap-2 text-sm font-medium text-foreground">
              <FileCode2 className="h-4 w-4" />
              <span className="truncate">{fileChange.file_name}</span>
            </div>
          )}
          <p className="mt-1 break-all text-xs text-muted-foreground">{fileChange.file_path}</p>
        </div>
        <span className="shrink-0 text-[11px] text-muted-foreground">
          {new Date(fileChange.created_at).toLocaleString()}
        </span>
      </div>
      <div className="mt-3 grid gap-2 text-sm">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Change</p>
          <p className="text-foreground">{fileChange.label}</p>
          <p className="mt-1 text-muted-foreground">{fileChange.summary}</p>
        </div>
        <div className="grid gap-2 md:grid-cols-2">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Why</p>
            <p className="text-foreground">{fileChange.why}</p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Impact</p>
            <p className="text-foreground">{fileChange.impact}</p>
          </div>
        </div>
      </div>
    </article>
  );
}

function LiveArtifacts({
  artifacts,
  editorScheme,
  fileChanges,
  workspaceRoot
}: {
  artifacts: Artifact[];
  editorScheme: string;
  fileChanges: FileChange[];
  workspaceRoot: string;
}) {
  const visibleArtifacts = artifacts.filter(artifact => artifact.artifact_type !== 'file_changes');

  if (!fileChanges.length && !visibleArtifacts.length) return null;

  return (
    <section>
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        Artifacts
      </h2>
      <div className="grid gap-4">
        {fileChanges.map(fileChange => (
          <LiveFileChangeCard
            key={fileChange.id}
            editorScheme={editorScheme}
            fileChange={fileChange}
            workspaceRoot={workspaceRoot}
          />
        ))}
        {visibleArtifacts.map(artifact => (
          <div key={artifact.id} className="min-w-0">
            <p className="mb-0.5 text-xs font-medium break-words">{artifact.label}</p>
            <p className="mb-1 text-xs text-muted-foreground">{artifact.artifact_type}</p>
            {artifact.uri ? (
              <a
                className="text-xs text-primary underline-offset-4 hover:underline break-all"
                href={artifact.uri}
              >
                {artifact.uri}
              </a>
            ) : null}
            {artifact.content ? (
              <MarkdownContent compact className="mt-1 text-xs text-muted-foreground">
                {artifact.content}
              </MarkdownContent>
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
        <LiveActivityFeed events={events} />
      </section>

      {(sharedState?.length ?? 0) > 0 || fileChanges.length > 0 || artifacts.length > 0 ? (
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
                      <code className="block max-h-32 overflow-auto whitespace-pre-wrap break-all rounded border bg-muted p-2 text-xs">
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
              fileChanges={fileChanges}
              workspaceRoot={workspaceRoot}
            />
          </div>
        </>
      ) : null}
    </>
  );
}
