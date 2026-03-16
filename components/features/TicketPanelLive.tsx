'use client';

import { Check, Copy, MessageSquare } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, useTransition } from 'react';

import { FileChangesArtifact } from '@/components/features/FileChangesArtifact';
import { MarkdownContent } from '@/components/features/MarkdownContent';
import { useTicketLive } from '@/components/features/TicketLiveProvider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { markSessionDisconnectedAction } from '@/lib/actions/tickets';
import {
  getAgentTypeByIdentifier,
  getAgentTypeByValue,
  LAUNCH_AGENT_VALUES,
  type LaunchAgentTypeValue
} from '@/lib/helpers/agent-types';
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
type SessionState = Database['public']['Enums']['session_state'];
type QuickstartCommands = Record<LaunchAgentTypeValue, string>;

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

function CommandCopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Button className="h-7 gap-1.5 px-2 text-xs" size="sm" variant="outline" onClick={handleCopy}>
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? 'Copied' : 'Copy'}
    </Button>
  );
}

function CommandRow({ label, command }: { label: string; command: string }) {
  return (
    <div className="rounded-md border bg-background/80 p-2.5">
      <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 overflow-x-auto whitespace-pre rounded bg-muted/60 px-2 py-1.5 text-xs">
          {command}
        </code>
        <CommandCopyButton value={command} />
      </div>
    </div>
  );
}

// --- LiveArtifacts ---

function LiveArtifacts({
  artifacts,
  editorScheme,
  workspaceRoot,
  projectId
}: {
  artifacts: Artifact[];
  editorScheme: string;
  workspaceRoot: string;
  projectId: string;
}) {
  if (!artifacts.length) return null;

  return (
    <section>
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        Artifacts
      </h2>
      <div className="grid gap-4">
        {artifacts.map(artifact => (
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
              artifact.artifact_type === 'file_changes' ? (
                <FileChangesArtifact
                  content={artifact.content}
                  editorScheme={editorScheme}
                  workspaceRoot={workspaceRoot}
                  projectId={projectId}
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
  claudeResumeCommand?: string;
  codexResumeCommand?: string;
  cursorResumeCommand?: string;
  geminiResumeCommand?: string;
};

export function TicketPanelLive({
  ticketId,
  projectId,
  editorScheme,
  workspaceRoot,
  workingDirectory: _workingDirectory,
  hasProjectWorkingDirectory: _hasProjectWorkingDirectory,
  agentToken: _agentToken,
  claudeCommand: _claudeCommand,
  codexCommand: _codexCommand,
  cursorCommand: _cursorCommand,
  geminiCommand: _geminiCommand,
  claudeResumeCommand: _claudeResumeCommand,
  codexResumeCommand: _codexResumeCommand,
  cursorResumeCommand: _cursorResumeCommand,
  geminiResumeCommand: _geminiResumeCommand
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
  const activeAgentType = getAgentTypeByIdentifier(session?.agent_identifier ?? null);
  const [selectedAgent, setSelectedAgent] = useState<LaunchAgentTypeValue>('claude');

  useEffect(() => {
    if (!activeAgentType) return;
    if (LAUNCH_AGENT_VALUES.includes(activeAgentType.value as LaunchAgentTypeValue)) {
      setSelectedAgent(activeAgentType.value as LaunchAgentTypeValue);
    }
  }, [activeAgentType]);

  const connectCommands = useMemo<QuickstartCommands>(
    () => ({
      claude: _claudeCommand ?? 'npx overlord run claude',
      codex: _codexCommand ?? 'npx overlord run codex',
      cursor: _cursorCommand ?? 'npx overlord run cursor',
      gemini: _geminiCommand ?? 'npx overlord run gemini'
    }),
    [_claudeCommand, _codexCommand, _cursorCommand, _geminiCommand]
  );

  const overlordResumeCommands = useMemo<QuickstartCommands>(
    () => ({
      claude: _claudeResumeCommand ?? 'npx overlord resume claude',
      codex: _codexResumeCommand ?? 'npx overlord resume codex',
      cursor: _cursorResumeCommand ?? 'npx overlord resume cursor',
      gemini: _geminiResumeCommand ?? 'npx overlord resume gemini'
    }),
    [_claudeResumeCommand, _codexResumeCommand, _cursorResumeCommand, _geminiResumeCommand]
  );

  const nativeResumeCommands: Partial<QuickstartCommands> = useMemo(
    () => ({
      claude: 'claude --resume <claude-session-id>',
      codex: 'codex resume <codex-session-id>'
    }),
    []
  );

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

      <section className="mb-6 rounded-lg border bg-muted/20 p-3">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          CLI Quickstart
        </h2>
        <div className="mb-3 flex flex-wrap gap-2">
          {LAUNCH_AGENT_VALUES.map(agentValue => {
            const agent = getAgentTypeByValue(agentValue);
            const isSelected = selectedAgent === agentValue;
            return (
              <Button
                key={agent.value}
                className="h-7 px-2 text-xs"
                size="sm"
                variant={isSelected ? 'default' : 'outline'}
                onClick={() => setSelectedAgent(agentValue)}
              >
                {agent.label}
              </Button>
            );
          })}
        </div>
        <div className="grid gap-2.5">
          <CommandRow label="Connect to this ticket" command={connectCommands[selectedAgent]} />
          <CommandRow
            label="Restart session"
            command={nativeResumeCommands[selectedAgent] ?? overlordResumeCommands[selectedAgent]}
          />
          {nativeResumeCommands[selectedAgent] ? (
            <CommandRow
              label="Restart session (Overlord wrapper)"
              command={overlordResumeCommands[selectedAgent]}
            />
          ) : null}
        </div>
      </section>

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
              workspaceRoot={workspaceRoot}
              projectId={projectId}
            />
          </div>
        </>
      ) : null}
    </>
  );
}
