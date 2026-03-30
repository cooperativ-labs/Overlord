import { Bot } from 'lucide-react';
import { headers } from 'next/headers';
import fs from 'node:fs/promises';

import { TimerWithTimeEntries } from '@/components/features/everhour/TimerWithTimeEntries';
import { InlineEditField } from '@/components/features/InlineEditField';
import { DueDateEditor } from '@/components/features/scheduling/DueDateEditor';
import { ScheduleEditor } from '@/components/features/scheduling/ScheduleEditor';
import { TicketDocumentUpload } from '@/components/features/TicketDocumentUpload';
import { TicketExecutionTargetSelect } from '@/components/features/TicketExecutionTargetSelect';
import { TicketLiveProvider } from '@/components/features/TicketLiveProvider';
import { TicketObjectivesSection } from '@/components/features/TicketObjectivesSection';
import { TicketPanelHeader } from '@/components/features/TicketPanelHeader';
import { TicketPanelLive } from '@/components/features/TicketPanelLive';
import { TicketProjectSelect } from '@/components/features/TicketProjectSelect';
import { TicketStatusSelect } from '@/components/features/TicketStatusSelect';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { getAllAgentConfigsByUserIdAction } from '@/lib/actions/agent-config';
import { ensureAgentTokenForLaunchAction } from '@/lib/actions/agent-tokens';
import { listTicketDocumentsAction } from '@/lib/actions/artifacts';
import { fetchProfileSettings } from '@/lib/actions/profile-settings';
import { getEditorScheme, getPlatformUrl, getWorkspaceRoot } from '@/lib/env';
import { listProjectFiles, resolveLinkedDirectory } from '@/lib/filesystem/project-file-tree';
import type { LaunchAgentTypeValue } from '@/lib/helpers/agent-types';
import { parseTicketAssignedAgent } from '@/lib/helpers/ticket-assigned-agent';
import { buildProjectPath } from '@/lib/helpers/ticket-path';
import { getTicketIdentifier } from '@/lib/helpers/tickets';
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
  const assignedAgent = parseTicketAssignedAgent(ticket.assigned_agent);

  // Fetch all related data in parallel. Individual query failures are
  // handled gracefully — the component still renders with partial data.
  const [
    eventsResult,
    stateResult,
    artifactsResult,
    fileChangesResult,
    statusesResult,
    everhourResult,
    projectsResult,
    scheduleResult,
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
      .from('file_changes')
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
      .select(
        'id,name,color,everhour_project_id,local_working_directory,ssh_command,remote_working_directory'
      )
      .eq('organization_id', organizationId)
      .order('name', { ascending: true }),
    ticket.schedule_id
      ? supabase
          .from('schedule')
          .select('period_type,period_interval,days_of_week,days_of_month,weeks_of_month,timezone')
          .eq('id', ticket.schedule_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
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
      .select('id,objective,is_executed,created_at,title,state,agent_identifier,model_identifier')
      .eq('ticket_id', ticketId)
      .order('created_at', { ascending: false })
  ]);

  const events = eventsResult.data;
  const state = stateResult.data;
  const artifacts = artifactsResult.data;
  const fileChanges = fileChangesResult.data;
  const statuses = statusesResult.data;
  const everhourIntegration = everhourResult.data;
  const projects = projectsResult.data;
  const schedule = scheduleResult.data;
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
      ? await ensureAgentTokenForLaunchAction(organizationId).catch(error => {
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

  const activeProject = projectOptions.find(project => project.id === activeProjectId);
  const projectWorkingDirectory = activeProject?.local_working_directory;
  const projectSshCommand = activeProject?.ssh_command ?? null;
  const projectRemoteWorkingDirectory = activeProject?.remote_working_directory ?? null;
  const configuredProjectDirectory =
    typeof projectWorkingDirectory === 'string' && projectWorkingDirectory.trim().length > 0
      ? projectWorkingDirectory.trim()
      : null;
  const workspaceRoot = getWorkspaceRoot(configuredProjectDirectory);
  const editorScheme = getEditorScheme(profileSettings?.editor_scheme);
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
    if (projectDirectoryExists && resolvedProjectDirectory) {
      objectiveFileMentionPaths = (await listProjectFiles(resolvedProjectDirectory)).files;
    } else {
      objectiveFileMentionPaths = [];
    }
  }
  const initialDocuments = await listTicketDocumentsAction(ticketId).catch(() => []);

  return (
    <TicketLiveProvider
      ticketId={ticketId}
      initialEvents={events ?? []}
      initialArtifacts={artifacts ?? []}
      initialFileChanges={fileChanges ?? []}
      initialSession={agentSession ?? null}
      initialSharedState={state ?? []}
    >
      <div className="flex h-full flex-col bg-background">
        <TicketPanelHeader
          ticketId={ticketId}
          ticketIdentifier={ticketIdentifier}
          projectId={activeProjectId}
          organizationId={organizationId}
          agentToken={agentToken}
          agentFlags={agentFlags}
          agentIdentifier={agentSession?.agent_identifier ?? null}
          assignedAgent={assignedAgent}
          claudeCommand={claudeCode}
          codexCommand={codex}
          cursorCommand={cursor}
          geminiCommand={gemini}
          opencodeCommand={opencode}
          workingDirectory={workingDirectory}
          sshCommand={projectSshCommand}
          remoteWorkingDirectory={projectRemoteWorkingDirectory}
          hasProjectWorkingDirectory={hasProjectWorkingDirectory}
          closePath={closePath}
          isAgentRunning={agentSession?.session_state === 'attached'}
        />

        <TimerWithTimeEntries
          initialTaskId={ticket.everhour_task_id ?? null}
          ticketId={ticketId}
          everhourIntegration={everhourIntegration ?? null}
        />

        <div className="flex-1 overflow-y-auto overflow-x-hidden bg-muted/50 pb-10 ">
          <section className="bg-background py-5">
            <div className="px-5">
              {ticket.delegate ? (
                <div className="mb-3 flex items-center gap-1.5 text-xs text-orange-500/90">
                  <Bot className="h-3.5 w-3.5 shrink-0" />
                  <span>Created by agent: {ticket.delegate}</span>
                </div>
              ) : null}
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

              <div className="mb-3 flex flex-wrap items-center gap-2">
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
              </div>

              <div className="mb-4 flex flex-wrap items-center gap-2">
                <DueDateEditor initialDueDatetime={ticket.due_datetime} ticketId={ticketId} />
                <ScheduleEditor
                  ticketId={ticketId}
                  hasSchedule={ticket.schedule_id !== null}
                  initialSchedule={
                    schedule
                      ? {
                          periodType: schedule.period_type,
                          periodInterval: schedule.period_interval,
                          daysOfWeek: Array.isArray(schedule.days_of_week)
                            ? schedule.days_of_week
                            : [],
                          daysOfMonth: schedule.days_of_month ?? undefined,
                          weeksOfMonth: schedule.weeks_of_month ?? undefined,
                          timezone: schedule.timezone
                        }
                      : null
                  }
                />
              </div>
            </div>
            <div className="flex flex-col pb-5">
              {/* <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Objectives
             </h2> */}
              <TicketObjectivesSection
                ticketId={ticketId}
                organizationId={organizationId}
                objectives={objectives ?? []}
                objectiveFileMentionPaths={objectiveFileMentionPaths}
                workingDirectory={workingDirectory}
              />

              {/* LaunchCommandBar is rendered inside TicketPanelLive to access real-time session state */}
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
