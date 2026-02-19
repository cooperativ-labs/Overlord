import { X } from 'lucide-react';
import Link from 'next/link';

import { CopyTicketPromptButton } from '@/components/features/CopyTicketPromptButton';
import { DeleteTicketButton } from '@/components/features/DeleteTicketButton';
import { TimerWithTimeEntries } from '@/components/features/everhour/TimerWithTimeEntries';
import { FileChangesArtifact } from '@/components/features/FileChangesArtifact';
import { InlineEditField } from '@/components/features/InlineEditField';
import { LaunchCommandBar } from '@/components/features/LaunchCommandBar';
import { TicketProjectSelect } from '@/components/features/TicketProjectSelect';
import { TicketStatusSelect } from '@/components/features/TicketStatusSelect';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { getAgentApiToken, getEditorScheme, getPlatformUrl, getWorkspaceRoot } from '@/lib/env';
import { getTicketIdentifier } from '@/lib/helpers/tickets';
import { createClient } from '@/supabase/utils/server';

const fallbackStatuses = [
  'draft',
  'review',
  'refine',
  'execute',
  'deliver',
  'complete',
  'blocked'
] as const;

function buildLaunchCommands(ticketId: string, platformUrl: string, token: string) {
  const contextUrl = `${platformUrl}/api/protocol/context/${ticketId}`;
  const curlFragment = `"$(curl -s -H 'Authorization: Bearer ${token}' ${contextUrl})"`;
  const envPrefix = `PLATFORM_URL=${platformUrl} AGENT_TOKEN=${token} TICKET_ID=${ticketId}`;
  return {
    claudeCode: `${envPrefix} claude --system ${curlFragment}`,
    codex: `${envPrefix} codex ${curlFragment}`
  };
}

export async function TicketPanelContent({
  ticketId,
  organizationId
}: {
  ticketId: string;
  organizationId: number;
}) {
  const supabase = await createClient();

  const [
    { data: ticket, error: ticketError },
    { data: events },
    { data: state },
    { data: artifacts },
    { data: statuses },
    { data: everhourIntegration },
    { data: projects }
  ] = await Promise.all([
    supabase
      .from('tickets')
      .select('*')
      .eq('id', ticketId)
      .eq('organization_id', organizationId)
      .single(),
    supabase
      .from('ticket_events')
      .select('*')
      .eq('ticket_id', ticketId)
      .order('created_at', { ascending: false })
      .limit(20),
    supabase
      .from('shared_state')
      .select('*')
      .eq('ticket_id', ticketId)
      .order('created_at', { ascending: false })
      .limit(20),
    supabase
      .from('artifacts')
      .select('*')
      .eq('ticket_id', ticketId)
      .order('created_at', { ascending: false })
      .limit(20),
    supabase
      .from('ticket_statuses')
      .select('name')
      .eq('organization_id', organizationId)
      .order('position', { ascending: true }),
    supabase
      .from('user_integrations')
      .select('id')
      .eq('provider', 'everhour')
      .limit(1)
      .maybeSingle(),
    supabase
      .from('projects')
      .select('id,name,color,everhour_project_id')
      .eq('organization_id', organizationId)
      .order('name', { ascending: true })
  ]);

  if (ticketError || !ticket) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <p className="text-sm text-muted-foreground">Ticket not found.</p>
      </div>
    );
  }

  const platformUrl = getPlatformUrl();
  const agentToken = getAgentApiToken();
  const workspaceRoot = getWorkspaceRoot();
  const editorScheme = getEditorScheme();
  const { claudeCode, codex } = buildLaunchCommands(ticketId, platformUrl, agentToken);
  const ticketIdentifier = getTicketIdentifier(ticket.id);
  const chatGptLink = `https://chat.openai.com/?q=${encodeURIComponent(`attach ${ticketIdentifier}`)}`;
  const statusOptions = statuses?.map(s => s.name) ?? fallbackStatuses;
  const hasEverhourIntegration = Boolean(everhourIntegration?.id);
  const projectOptions = projects ?? [];

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <p className="text-sm font-medium text-muted-foreground">{ticketIdentifier}</p>
        <div className="flex items-center gap-1">
          {hasEverhourIntegration ? (
            <TimerWithTimeEntries
              initialTaskId={ticket.everhour_task_id ?? null}
              ticketId={ticketId}
            />
          ) : (
            <CopyTicketPromptButton ticketId={ticketId} variant="default" />
          )}
          <DeleteTicketButton ticketId={ticketId} ticketLabel={ticketIdentifier} />
          <Button asChild size="icon" variant="ghost" className="h-8 w-8">
            <Link href={`/${organizationId}`} aria-label="Close panel">
              <X className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-5">
        <div className="mb-4">
          <InlineEditField
            displayClassName="text-xl font-bold tracking-tight"
            field="title"
            initialValue={ticket.title ?? ''}
            inputClassName="text-xl font-bold tracking-tight"
            placeholder="Untitled — click to add a title"
            ticketId={ticketId}
          />
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <TicketStatusSelect
            currentStatus={ticket.status ?? ''}
            statusOptions={[...statusOptions]}
            ticketId={ticketId}
          />
          <div className="h-4 w-px bg-border" />
          <Badge className="rounded-full" variant="outline">
            Priority {ticket.priority}
          </Badge>
          {ticket.assigned_agent ? (
            <Badge className="rounded-full" variant="secondary">
              {ticket.assigned_agent}
            </Badge>
          ) : null}
        </div>

        <TicketProjectSelect
          ticketId={ticketId}
          organizationId={organizationId}
          currentProjectId={ticket.project_id}
          projects={projectOptions}
        />

        <LaunchCommandBar
          chatGptLink={chatGptLink}
          claudeCommand={claudeCode}
          codexCommand={codex}
        />

        {!hasEverhourIntegration ? (
          <>
            <Separator className="mb-6" />
            <section className="mb-6">
              <p className="text-muted-foreground text-sm">
                Connect Everhour in{' '}
                <Link href="/account" className="underline">
                  Account settings
                </Link>{' '}
                to start tracking time on this ticket.
              </p>
            </section>
            <Separator className="mb-6" />
          </>
        ) : null}

        <section className="mb-6">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Description
          </h2>
          <InlineEditField
            displayClassName="text-sm leading-relaxed"
            field="objective"
            initialValue={ticket.objective ?? ''}
            multiline
            placeholder="No description — click to add one."
            ticketId={ticketId}
          />
        </section>

        <section className="mb-6">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Available Tools
          </h2>
          <InlineEditField
            displayClassName="text-sm leading-relaxed"
            field="available_tools"
            initialValue={ticket.available_tools ?? ''}
            multiline
            placeholder="None specified — click to add."
            ticketId={ticketId}
          />
        </section>

        <section className="mb-6">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Acceptance Criteria
          </h2>
          <InlineEditField
            displayClassName="text-sm leading-relaxed"
            field="acceptance_criteria"
            initialValue={ticket.acceptance_criteria ?? ''}
            multiline
            placeholder="None specified — click to add."
            ticketId={ticketId}
          />
        </section>

        <Separator className="mb-6" />

        <section className="mb-6">
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Activity
          </h2>
          {!events?.length ? (
            <p className="text-sm italic text-muted-foreground">No events yet.</p>
          ) : (
            <div className="grid gap-3">
              {events.map(event => (
                <article className="flex gap-3" key={event.id}>
                  <div className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-muted-foreground/30" />
                  <div className="grid gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-medium">{event.event_type}</span>
                      {event.phase ? (
                        <Badge className="h-5 rounded-full px-2 text-xs" variant="secondary">
                          {event.phase}
                        </Badge>
                      ) : null}
                      <span className="text-xs text-muted-foreground">
                        {new Date(event.created_at).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {event.summary ?? 'No summary.'}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        {(state?.length ?? 0) > 0 || (artifacts?.length ?? 0) > 0 ? (
          <>
            <Separator className="mb-6" />
            <div className="grid gap-6">
              {(state?.length ?? 0) > 0 ? (
                <section>
                  <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                    Shared State
                  </h2>
                  <div className="grid gap-3">
                    {state!.map(item => (
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
              {(artifacts?.length ?? 0) > 0 ? (
                <section>
                  <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                    Artifacts
                  </h2>
                  <div className="grid gap-4">
                    {artifacts!.map(artifact => (
                      <div key={artifact.id}>
                        <p className="mb-0.5 text-xs font-medium">{artifact.label}</p>
                        <p className="mb-1 text-xs text-muted-foreground">
                          {artifact.artifact_type}
                        </p>
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
                          ) : artifact.artifact_type === 'next_steps' ? (
                            <ul className="mt-1 grid gap-1 pl-3">
                              {artifact.content
                                .split('\n')
                                .map((l: string) => l.trim())
                                .filter(Boolean)
                                .map((line: string, i: number) => (
                                  <li className="list-disc text-xs text-muted-foreground" key={i}>
                                    {line.replace(/^[-*]\s+/, '')}
                                  </li>
                                ))}
                            </ul>
                          ) : (
                            <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded border bg-muted p-2 text-xs">
                              {artifact.content}
                            </pre>
                          )
                        ) : null}
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
