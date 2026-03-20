import { ChevronDown } from 'lucide-react';
import { headers } from 'next/headers';
import Image from 'next/image';
import fs from 'node:fs/promises';

import { TimerWithTimeEntries } from '@/components/features/everhour/TimerWithTimeEntries';
import { InlineEditField } from '@/components/features/InlineEditField';
import { MarkdownContent } from '@/components/features/MarkdownContent';
import { ObjectiveMenuButton } from '@/components/features/ObjectiveMenuButton';
import { TicketDocumentUpload } from '@/components/features/TicketDocumentUpload';
import { TicketExecutionTargetSelect } from '@/components/features/TicketExecutionTargetSelect';
import { TicketLiveProvider } from '@/components/features/TicketLiveProvider';
import { TicketPanelHeader } from '@/components/features/TicketPanelHeader';
import { TicketPanelLive } from '@/components/features/TicketPanelLive';
import { TicketProjectSelect } from '@/components/features/TicketProjectSelect';
import { TicketStatusSelect } from '@/components/features/TicketStatusSelect';
import { TicketToolsAndCriteria } from '@/components/features/TicketToolsAndCriteria';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { getAllAgentConfigsByUserIdAction } from '@/lib/actions/agent-config';
import { ensureAgentTokenAction } from '@/lib/actions/agent-tokens';
import { listTicketDocumentsAction } from '@/lib/actions/artifacts';
import { fetchProfileSettings } from '@/lib/actions/profile-settings';
import { getEditorScheme, getPlatformUrl, getWorkspaceRoot } from '@/lib/env';
import { listProjectFiles, resolveLinkedDirectory } from '@/lib/filesystem/project-file-tree';
import { getAgentTypeByIdentifier, type LaunchAgentTypeValue } from '@/lib/helpers/agent-types';
import { buildProjectPath } from '@/lib/helpers/ticket-path';
import { getTicketIdentifier } from '@/lib/helpers/tickets';
import { sortObjectivesByCreatedAtAscending } from '@/lib/objectives';
import { buildLaunchCommands, buildResumeCommands } from '@/lib/overlord/launch-commands';
import { createClient } from '@/supabase/utils/server';
import type { Database } from '@/types/database.types';

const fallbackStatuses = ['draft', 'execute', 'review', 'deliver', 'complete', 'blocked'] as const;
const CREATED_TICKET_WAIT_RETRIES = 12;
const CREATED_TICKET_WAIT_MS = 250;

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function TicketPanelContent({
  ticketId,
  organizationId,
  closePath: closePathProp
}: {
  ticketId: string;
  organizationId: number;
  closePath?: string;
}) {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  let ticket: Database['public']['Tables']['tickets']['Row'] | null = null;
  let ticketError: Error | null = null;

  for (let attempt = 0; attempt <= CREATED_TICKET_WAIT_RETRIES; attempt += 1) {
    const { data, error } = await supabase
      .from('tickets')
      .select('*')
      .eq('id', ticketId)
      .eq('organization_id', organizationId)
      .maybeSingle();

    if (error) {
      ticketError = new Error(error.message);
      break;
    }

    if (data) {
      ticket = data;
      break;
    }

    if (attempt < CREATED_TICKET_WAIT_RETRIES) {
      await sleep(CREATED_TICKET_WAIT_MS);
    }
  }

  if (ticketError || !ticket) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <p className="text-sm text-muted-foreground">Ticket not found.</p>
      </div>
    );
  }

  const profileSettings = user ? await fetchProfileSettings(supabase, user.id) : null;

  // Fetch all related data in parallel. Individual query failures are
  // handled gracefully — the component still renders with partial data.
  const [
    eventsResult,
    stateResult,
    artifactsResult,
    statusesResult,
    everhourResult,
    projectsResult,
    agentSessionResult,
    agentTokenResult,
    objectivesResult
  ] = await Promise.all([
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
      .select('token, expires_at')
      .eq('user_id', user?.id ?? '')
      .eq('organization_id', organizationId)
      .is('revoked_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('objectives')
      .select('id,objective,is_executed,created_at')
      .eq('ticket_id', ticketId)
      .order('created_at', { ascending: false })
  ]);

  const events = eventsResult.data;
  const state = stateResult.data;
  const artifacts = artifactsResult.data;
  const statuses = statusesResult.data;
  const everhourIntegration = everhourResult.data;
  const projects = projectsResult.data;
  const agentSession = agentSessionResult.data;
  const agentTokenRow = agentTokenResult.data;
  const objectives = objectivesResult.data;

  const platformUrl = getPlatformUrl();
  const agentConfigs = user ? await getAllAgentConfigsByUserIdAction(user.id, supabase) : {};
  const existingAgentToken =
    agentTokenRow &&
    (!agentTokenRow.expires_at || new Date(agentTokenRow.expires_at).getTime() > Date.now())
      ? agentTokenRow.token
      : null;
  const agentToken =
    existingAgentToken ??
    (user
      ? await ensureAgentTokenAction(organizationId).catch(error => {
          console.error('Failed to ensure agent token for ticket launch:', error);
          return null;
        })
      : null);
  const agentFlags: Partial<Record<LaunchAgentTypeValue, string[]>> = {
    claude: agentConfigs.claude?.flags ?? [],
    codex: agentConfigs.codex?.flags ?? [],
    cursor: agentConfigs.cursor?.flags ?? [],
    gemini: agentConfigs.gemini?.flags ?? [],
    opencode: agentConfigs.opencode?.flags ?? []
  };
  const workspaceRoot = getWorkspaceRoot();
  const editorScheme = getEditorScheme(profileSettings?.editor_scheme);
  const { claudeCode, codex, cursor, gemini, opencode } = buildLaunchCommands({
    platformUrl,
    ticketId,
    token: agentToken ?? ''
  });
  const {
    claudeCode: claudeResume,
    codex: codexResume,
    cursor: cursorResume,
    gemini: geminiResume,
    opencode: opencodeResume
  } = buildResumeCommands({
    platformUrl,
    ticketId,
    token: agentToken ?? ''
  });
  const ticketIdentifier = getTicketIdentifier(ticket.id);
  const statusOptions = statuses?.map(s => s.name) ?? fallbackStatuses;

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
  const configuredProjectDirectory =
    typeof projectWorkingDirectory === 'string' && projectWorkingDirectory.trim().length > 0
      ? projectWorkingDirectory.trim()
      : null;
  const headerStore = await headers();
  const userAgent = headerStore.get('user-agent') ?? '';
  const isElectronRequest = /electron/i.test(userAgent);
  const closePath = closePathProp ?? buildProjectPath({ projectId: activeProjectId });
  const resolvedProjectDirectory = resolveLinkedDirectory(configuredProjectDirectory);
  const resolvedWorkspaceDirectory = resolveLinkedDirectory(workspaceRoot);
  let workingDirectory: string | null;
  let hasProjectWorkingDirectory: boolean;
  let objectiveFileMentionPaths: string[];

  if (isElectronRequest) {
    // Electron uses IPC for local filesystem checks. Keep the configured path here so
    // client-side launch components can validate and use the real local directory.
    workingDirectory = configuredProjectDirectory;
    hasProjectWorkingDirectory = Boolean(configuredProjectDirectory);
    objectiveFileMentionPaths = [];
  } else {
    const projectDirectoryExists = resolvedProjectDirectory
      ? Boolean((await fs.stat(resolvedProjectDirectory).catch(() => null))?.isDirectory())
      : false;
    const workspaceDirectoryExists = resolvedWorkspaceDirectory
      ? Boolean((await fs.stat(resolvedWorkspaceDirectory).catch(() => null))?.isDirectory())
      : false;

    workingDirectory = projectDirectoryExists
      ? resolvedProjectDirectory
      : workspaceDirectoryExists
        ? resolvedWorkspaceDirectory
        : null;
    hasProjectWorkingDirectory = projectDirectoryExists;
    objectiveFileMentionPaths =
      projectDirectoryExists && resolvedProjectDirectory
        ? (await listProjectFiles(resolvedProjectDirectory)).files
        : [];
  }
  const objectiveThreadItems = objectives ?? [];
  const draftObjective = objectiveThreadItems.find(objective => !objective.is_executed) ?? null;
  const executedObjectives = objectiveThreadItems.filter(
    objective => objective.is_executed && objective.objective.trim().length > 0
  );
  const orderedExecutedObjectives = sortObjectivesByCreatedAtAscending(executedObjectives);
  const draftObjectiveValue = draftObjective?.objective ?? ticket.objective ?? '';
  const initialDocuments = await listTicketDocumentsAction(ticketId).catch(() => []);

  return (
    <TicketLiveProvider
      ticketId={ticketId}
      initialEvents={events ?? []}
      initialArtifacts={artifacts ?? []}
      initialSession={agentSession ?? null}
      initialSharedState={state ?? []}
    >
      <div className="flex h-full flex-col bg-background">
        <TicketPanelHeader
          ticketId={ticketId}
          ticketIdentifier={ticketIdentifier}
          organizationId={organizationId}
          agentToken={agentToken}
          agentFlags={agentFlags}
          agentIdentifier={agentSession?.agent_identifier ?? null}
          claudeCommand={claudeCode}
          codexCommand={codex}
          cursorCommand={cursor}
          geminiCommand={gemini}
          opencodeCommand={opencode}
          workingDirectory={workingDirectory}
          hasProjectWorkingDirectory={hasProjectWorkingDirectory}
          closePath={closePath}
          isAgentRunning={agentSession?.session_state === 'attached'}
        />

        <TimerWithTimeEntries
          initialTaskId={ticket.everhour_task_id ?? null}
          ticketId={ticketId}
          everhourIntegration={everhourIntegration ?? null}
        />

        <div className="flex-1 overflow-y-auto overflow-x-hidden  bg-muted/50 ">
          <section className="bg-background py-5">
            <div className="px-5">
              <div className="mb-4">
                <InlineEditField
                  displayClassName="text-xl font-bold tracking-tight"
                  field="title"
                  organizationId={organizationId}
                  initialValue={ticket.title ?? ''}
                  inputClassName="text-xl font-bold tracking-tight"
                  placeholder="Untitled — click to add a title"
                  ticketId={ticketId}
                />
              </div>

              <div className="mb-4 flex flex-wrap items-center gap-2">
                <TicketProjectSelect
                  ticketId={ticketId}
                  organizationId={organizationId}
                  currentProjectId={activeProjectId}
                  projects={projectOptions}
                />
                <div className="h-4 w-px bg-border" />
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

                {(() => {
                  const runningAgent =
                    agentSession?.session_state === 'attached'
                      ? agentSession.agent_identifier
                      : null;
                  const displayAgent =
                    runningAgent ?? ticket.recent_agent ?? ticket.assigned_agent ?? null;
                  if (!displayAgent) return null;
                  const agentType = getAgentTypeByIdentifier(displayAgent);
                  return (
                    <Badge className="rounded-full gap-1.5" variant="secondary">
                      {agentType ? (
                        <>
                          <Image
                            src={agentType.icon}
                            alt={`${agentType.label} icon`}
                            width={12}
                            height={12}
                            className="h-3 w-3"
                          />
                          {agentType.label}
                        </>
                      ) : (
                        displayAgent
                      )}
                    </Badge>
                  );
                })()}
              </div>
            </div>
            <div className="flex flex-col pb-5">
              {/* <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Objectives
             </h2> */}
              <div className="px-5">
                {orderedExecutedObjectives.length > 0 ? (
                  <div className="mb-3 space-y-2 bg-background rounded-md border">
                    {orderedExecutedObjectives.map((objective, index) => (
                      <Collapsible key={objective.id}>
                        <div className="flex items-center gap-1 hover:bg-background rounded-md pr-1">
                          <CollapsibleTrigger asChild>
                            <button
                              className="flex flex-1 items-center justify-between hover:bg-background px-3 py-2 text-left rounded-md "
                              type="button"
                            >
                              <div>
                                <p className="text-sm font-medium">Objective {index + 1}</p>
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
                        <CollapsibleContent className="px-3 pb-2 pt-1">
                          <MarkdownContent compact>{objective.objective}</MarkdownContent>
                        </CollapsibleContent>
                      </Collapsible>
                    ))}
                  </div>
                ) : null}

                <div className="flex items-start gap-1 w-full border rounded-md">
                  <InlineEditField
                    key={draftObjective?.id ?? 'current-objective'}
                    displayClassName="text-base leading-relaxed"
                    inputClassName="text-base leading-relaxed"
                    variant="textarea"
                    field="objective"
                    organizationId={organizationId}
                    fileMentionPaths={objectiveFileMentionPaths}
                    workingDirectory={workingDirectory}
                    initialValue={draftObjectiveValue}
                    multiline
                    renderMarkdown
                    placeholder="Click to add an objective…"
                    ticketId={ticketId}
                  >
                    {' '}
                    <ObjectiveMenuButton
                      ticketId={ticketId}
                      objectiveId={draftObjective?.id ?? ''}
                      isExecuted={!draftObjective || draftObjective.is_executed}
                      canMarkExecuted={Boolean(draftObjective?.objective?.trim())}
                    />
                  </InlineEditField>
                </div>

                {/* LaunchCommandBar is rendered inside TicketPanelLive to access real-time session state */}
              </div>
            </div>
          </section>
          <section className="flex flex-col px-5 pt-5 ">
            {/* <TicketToolsAndCriteria
              organizationId={organizationId}
              ticketId={ticketId}
              availableTools={ticket.available_tools}
              acceptanceCriteria={ticket.acceptance_criteria}
            /> */}

            <TicketDocumentUpload ticketId={ticketId} initialDocuments={initialDocuments} />

            <ErrorBoundary>
              <TicketPanelLive
                ticketId={ticketId}
                projectId={activeProjectId}
                editorScheme={editorScheme}
                workspaceRoot={workspaceRoot}
                workingDirectory={workingDirectory}
                hasProjectWorkingDirectory={hasProjectWorkingDirectory}
                agentToken={agentToken}
                claudeCommand={claudeCode}
                codexCommand={codex}
                cursorCommand={cursor}
                geminiCommand={gemini}
                opencodeCommand={opencode}
                claudeResumeCommand={claudeResume}
                codexResumeCommand={codexResume}
                cursorResumeCommand={cursorResume}
                geminiResumeCommand={geminiResume}
                opencodeResumeCommand={opencodeResume}
              />
            </ErrorBoundary>
          </section>
        </div>
      </div>
    </TicketLiveProvider>
  );
}
