import { ChevronDown, X } from 'lucide-react';
import Link from 'next/link';
import fs from 'node:fs/promises';

import { CopyTicketPromptButton } from '@/components/features/CopyTicketPromptButton';
import { DeleteTicketButton } from '@/components/features/DeleteTicketButton';
import { TimerWithTimeEntries } from '@/components/features/everhour/TimerWithTimeEntries';
import { InlineEditField } from '@/components/features/InlineEditField';
import { MarkdownContent } from '@/components/features/MarkdownContent';
import { ObjectiveMenuButton } from '@/components/features/ObjectiveMenuButton';
import { TicketExecutionTargetSelect } from '@/components/features/TicketExecutionTargetSelect';
import { TicketPanelLive } from '@/components/features/TicketPanelLive';
import { TicketProjectSelect } from '@/components/features/TicketProjectSelect';
import { TicketStatusSelect } from '@/components/features/TicketStatusSelect';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Separator } from '@/components/ui/separator';
import { getEditorScheme, getPlatformUrl, getWorkspaceRoot } from '@/lib/env';
import { listProjectFiles, resolveLinkedDirectory } from '@/lib/filesystem/project-file-tree';
import { buildProjectPath } from '@/lib/helpers/ticket-path';
import { getTicketIdentifier } from '@/lib/helpers/tickets';
import { sortObjectivesByCreatedAtAscending } from '@/lib/objectives';
import { buildLaunchCommands } from '@/lib/overlord/launch-commands';
import { createClient } from '@/supabase/utils/server';

const fallbackStatuses = ['draft', 'execute', 'review', 'deliver', 'complete', 'blocked'] as const;

export async function TicketPanelContent({
  ticketId,
  organizationId
}: {
  ticketId: string;
  organizationId: number;
}) {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  const [
    { data: ticket, error: ticketError },
    { data: events },
    { data: state },
    { data: artifacts },
    { data: statuses },
    { data: everhourIntegration },
    { data: projects },
    { data: agentSession },
    { data: agentTokenRow },
    { data: objectives }
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
      .select('api_key')
      .eq('user_id', user?.id ?? '')
      .eq('provider', 'everhour')
      .limit(1)
      .maybeSingle(),
    supabase
      .from('projects')
      .select('id,name,color,everhour_project_id,local_working_directory')
      .eq('organization_id', organizationId)
      .order('name', { ascending: true }),
    supabase
      .from('agent_sessions')
      .select('*')
      .eq('ticket_id', ticketId)
      .order('attached_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('agent_tokens')
      .select('token')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('objectives')
      .select('id,objective,is_executed,created_at')
      .eq('ticket_id', ticketId)
      .order('created_at', { ascending: false })
  ]);

  if (ticketError || !ticket) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <p className="text-sm text-muted-foreground">Ticket not found.</p>
      </div>
    );
  }

  const platformUrl = getPlatformUrl();
  const agentToken = agentTokenRow?.token ?? null;
  const workspaceRoot = getWorkspaceRoot();
  const editorScheme = getEditorScheme();
  const { claudeCode, codex } = buildLaunchCommands({
    platformUrl,
    ticketId,
    token: agentToken ?? ''
  });
  const ticketIdentifier = getTicketIdentifier(ticket.id);
  const statusOptions = statuses?.map(s => s.name) ?? fallbackStatuses;
  const everhourApiKey =
    typeof everhourIntegration?.api_key === 'string' ? everhourIntegration.api_key.trim() : '';
  const hasEverhourApiKey = everhourApiKey.length > 0;
  const projectOptions = projects ?? [];
  const activeProjectId = ticket.project_id ?? projectOptions[0]?.id;
  if (!activeProjectId) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <p className="text-sm text-muted-foreground">Project not found for this ticket.</p>
      </div>
    );
  }

  const projectWorkingDirectory = projectOptions.find(
    project => project.id === activeProjectId
  )?.local_working_directory;
  const closePath = buildProjectPath({
    organizationId,
    projectId: activeProjectId
  });
  const resolvedProjectDirectory = resolveLinkedDirectory(projectWorkingDirectory);
  const resolvedWorkspaceDirectory = resolveLinkedDirectory(workspaceRoot);

  const projectDirectoryExists = resolvedProjectDirectory
    ? Boolean((await fs.stat(resolvedProjectDirectory).catch(() => null))?.isDirectory())
    : false;
  const workspaceDirectoryExists = resolvedWorkspaceDirectory
    ? Boolean((await fs.stat(resolvedWorkspaceDirectory).catch(() => null))?.isDirectory())
    : false;

  const workingDirectory = projectDirectoryExists
    ? resolvedProjectDirectory
    : workspaceDirectoryExists
      ? resolvedWorkspaceDirectory
      : null;

  const objectiveFileMentionPaths =
    projectDirectoryExists && resolvedProjectDirectory
      ? (await listProjectFiles(resolvedProjectDirectory)).files
      : [];
  const objectiveThreadItems = objectives ?? [];
  const draftObjective = objectiveThreadItems.find(objective => !objective.is_executed) ?? null;
  const executedObjectives = objectiveThreadItems.filter(
    objective => objective.is_executed && objective.objective.trim().length > 0
  );
  const orderedExecutedObjectives = sortObjectivesByCreatedAtAscending(executedObjectives);
  const draftObjectiveValue = draftObjective?.objective ?? ticket.objective ?? '';

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <p className="text-sm font-medium text-muted-foreground">{ticketIdentifier}</p>
        <div className="flex items-center gap-1">
          {hasEverhourApiKey ? (
            <TimerWithTimeEntries
              initialTaskId={ticket.everhour_task_id ?? null}
              ticketId={ticketId}
            />
          ) : (
            <CopyTicketPromptButton ticketId={ticketId} runInTerminal={false} variant="default" />
          )}
          <DeleteTicketButton ticketId={ticketId} ticketLabel={ticketIdentifier} />
          <Button asChild size="icon" variant="ghost" className="h-8 w-8">
            <Link href={closePath} aria-label="Close panel">
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
          <TicketExecutionTargetSelect
            currentExecutionTarget={ticket.execution_target ?? 'agent'}
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
          currentProjectId={activeProjectId}
          projects={projectOptions}
        />

        {!hasEverhourApiKey ? (
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

        <section className="mb-8 rounded-xl border border-primary/25 bg-primary/[0.04] p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-widest text-primary/90">
            Objective
          </h2>
          {orderedExecutedObjectives.length > 0 ? (
            <div className="mb-3 space-y-2">
              {orderedExecutedObjectives.map((objective, index) => (
                <Collapsible key={objective.id}>
                  <div className="flex items-start gap-1">
                    <CollapsibleTrigger asChild>
                      <button
                        className="flex flex-1 items-center justify-between rounded-md border bg-background px-3 py-2 text-left hover:bg-muted/40"
                        type="button"
                      >
                        <div>
                          <p className="text-sm font-medium">Previous Objective {index + 1}</p>
                          <p className="text-xs text-muted-foreground">
                            Executed {new Date(objective.created_at).toLocaleString()}
                          </p>
                        </div>
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      </button>
                    </CollapsibleTrigger>
                    <ObjectiveMenuButton
                      ticketId={ticketId}
                      objectiveId={objective.id}
                      isExecuted={objective.is_executed}
                      canMarkExecuted={objective.objective.trim().length > 0}
                    />
                  </div>
                  <CollapsibleContent className="px-1 pb-2 pt-1">
                    <MarkdownContent compact>{objective.objective}</MarkdownContent>
                  </CollapsibleContent>
                </Collapsible>
              ))}
            </div>
          ) : null}

          <div className="rounded-md border bg-background p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Current Objective
              </p>
              <ObjectiveMenuButton
                ticketId={ticketId}
                objectiveId={draftObjective?.id ?? ''}
                isExecuted={!draftObjective || draftObjective.is_executed}
                canMarkExecuted={Boolean(draftObjective?.objective?.trim())}
              />
            </div>
            <InlineEditField
              key={draftObjective?.id ?? 'current-objective'}
              displayClassName="text-sm leading-relaxed"
              field="objective"
              fileMentionPaths={objectiveFileMentionPaths}
              initialValue={draftObjectiveValue}
              multiline
              renderMarkdown
              placeholder="No objective — click to add one."
              ticketId={ticketId}
            />
          </div>

          {/* LaunchCommandBar is rendered inside TicketPanelLive to access real-time session state */}
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

        <TicketPanelLive
          ticketId={ticketId}
          projectId={activeProjectId}
          initialEvents={events ?? []}
          initialArtifacts={artifacts ?? []}
          initialSession={agentSession ?? null}
          initialState={state ?? []}
          editorScheme={editorScheme}
          workspaceRoot={workspaceRoot}
          workingDirectory={workingDirectory}
          agentToken={agentToken}
          claudeCommand={claudeCode}
          codexCommand={codex}
        />
      </div>
    </div>
  );
}
