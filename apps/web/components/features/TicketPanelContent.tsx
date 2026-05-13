import { Bot, MessageSquare } from 'lucide-react';
import { headers } from 'next/headers';
import fs from 'node:fs/promises';

import { TimerWithTimeEntries } from '@/components/features/everhour/TimerWithTimeEntries';
import { DueDateEditor } from '@/components/features/scheduling/DueDateEditor';
import { ScheduleEditor } from '@/components/features/scheduling/ScheduleEditor';
import { TicketExecutionTargetSelect } from '@/components/features/TicketExecutionTargetSelect';
import { TicketLiveProvider } from '@/components/features/TicketLiveProvider';
import { TicketObjectivesSection } from '@/components/features/TicketObjectivesSection';
import { TicketPanelHeader } from '@/components/features/TicketPanelHeader';
import { TicketPanelLive } from '@/components/features/TicketPanelLive';
import { TicketTitleField } from '@/components/features/TicketTitleField';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { getAllAgentConfigsByUserIdAction } from '@/lib/actions/agent-config';
import { listObjectiveAttachmentsAction } from '@/lib/actions/attachments';
import { fetchProfileSettings } from '@/lib/actions/profile-settings';
import {
  resolveProjectUserSshSettings,
  resolveVisibleProjectSshSettings
} from '@/lib/actions/project-types';
import {
  getProjectUserLocalSettingsByProjectId,
  getProjectUserSshSettingsByProjectId
} from '@/lib/actions/projects';
import { getTicketTagsAction } from '@/lib/actions/tags';
import { isAppFeatureEnabled } from '@/lib/app-features';
import { getEditorScheme, getPlatformUrl, getWorkspaceRoot } from '@/lib/env';
import { listProjectFiles, resolveLinkedDirectory } from '@/lib/filesystem/project-file-tree';
import type { LaunchAgentTypeValue } from '@/lib/helpers/agent-types';
import { parseObjectiveAssignedAgent } from '@/lib/helpers/ticket-assigned-agent';
import { buildProjectPath } from '@/lib/helpers/ticket-path';
import { getTicketIdentifier } from '@/lib/helpers/tickets';
import {
  type AgentCommands,
  buildLaunchCommands,
  buildResumeCommands
} from '@/lib/overlord/launch-commands';
import { createClientForRequest } from '@/supabase/utils/server';
import type { Database } from '@/types/database.types';

import { TicketTagEditor } from './TicketTagEditor';
import { TicketToolsAndCriteria } from './TicketToolsAndCriteria';

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
  const supabase = await createClientForRequest();
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
  const projectsSelect = 'id,name,color,everhour_project_id';

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
    objectivesResult,
    checkpointsResult
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
      .select(projectsSelect)
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
      .from('objectives')
      .select(
        'id,objective,created_at,title,state,agent_identifier,model_identifier,assigned_agent'
      )
      .eq('ticket_id', ticketId)
      .order('created_at', { ascending: false }),
    supabase
      .from('project_checkpoints')
      .select('objective_id,git_ref_name,git_commit_id,checkpoint_kind')
      .eq('ticket_id', ticketId)
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
  const objectives = objectivesResult.data;
  const checkpointsByObjectiveId = Object.fromEntries(
    (checkpointsResult.data ?? []).map(cp => [cp.objective_id, cp])
  );
  const editableObjective =
    objectives?.find(objective => objective.state === 'submitted') ??
    objectives?.find(objective => objective.state === 'draft') ??
    null;
  const assignedAgent = editableObjective
    ? parseObjectiveAssignedAgent(editableObjective.assigned_agent)
    : null;
  const projectOptionsRaw = projects ?? [];
  const projectIdsForSettings = projectOptionsRaw.map(project => project.id);
  const sshEnabled = await isAppFeatureEnabled('ssh');
  const futureObjectivesEnabled = await isAppFeatureEnabled('future-objectives');
  const [sshSettingsByProjectId, localSettingsByProjectId] = await Promise.all([
    getProjectUserSshSettingsByProjectId(supabase, user?.id, projectIdsForSettings),
    getProjectUserLocalSettingsByProjectId(supabase, user?.id, projectIdsForSettings)
  ]);
  const projectOptions = projectOptionsRaw.map(project => ({
    ...project,
    local_working_directory:
      localSettingsByProjectId.get(project.id)?.local_working_directory ?? null,
    ...resolveVisibleProjectSshSettings(
      resolveProjectUserSshSettings(sshSettingsByProjectId.get(project.id)),
      { sshEnabled }
    )
  }));

  const platformUrl = getPlatformUrl();
  const agentConfigs = user ? await getAllAgentConfigsByUserIdAction(user.id, supabase) : {};
  const agentFlags: Partial<Record<LaunchAgentTypeValue, string[]>> = {
    claude: agentConfigs.claude?.flags ?? [],
    codex: agentConfigs.codex?.flags ?? [],
    cursor: agentConfigs.cursor?.flags ?? [],
    gemini: agentConfigs.gemini?.flags ?? [],
    opencode: agentConfigs.opencode?.flags ?? []
  };
  const ticketIdentifier = getTicketIdentifier(ticket);
  const statusOptions = statuses?.map(s => s.name) ?? fallbackStatuses;

  const activeProjectId = ticket.project_id;
  const activeProject = activeProjectId
    ? projectOptions.find(project => project.id === activeProjectId)
    : null;
  const projectWorkingDirectory = activeProject?.local_working_directory;
  const projectSshCommand = activeProject?.sshCommand ?? null;
  const projectRemoteWorkingDirectory = activeProject?.remoteWorkingDirectory ?? null;
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

  const launchTicketId = ticket?.ticket_id || ticketId;
  const launchCommands = buildLaunchCommands({
    platformUrl,
    ticketId: launchTicketId,
    organizationId,
    workingDirectory,
    agentFlags,
    assignedAgent
  });
  const resumeCommands = buildResumeCommands({
    platformUrl,
    ticketId: launchTicketId,
    organizationId
  });
  const agentCommands: AgentCommands = { launchCommands, resumeCommands };
  const objectiveAttachments = await listObjectiveAttachmentsAction(ticketId).catch(() => []);
  const initialTags = ticket.project_id ? await getTicketTagsAction(ticketId).catch(() => []) : [];

  return (
    <TicketLiveProvider
      ticketId={ticketId}
      ticketReference={ticketIdentifier}
      initialEvents={events ?? []}
      initialArtifacts={artifacts ?? []}
      initialFileChanges={fileChanges ?? []}
      initialSession={agentSession ?? null}
      initialSharedState={state ?? []}
    >
      <div className="flex h-full flex-col bg-card">
        <TicketPanelHeader
          ticketId={ticketId}
          ticketIdentifier={ticketIdentifier}
          organizationId={organizationId}
          projectId={activeProjectId}
          projects={projectOptions.map(p => ({
            id: p.id,
            name: p.name,
            color: p.color,
            everhour_project_id: p.everhour_project_id
          }))}
          currentStatus={ticket.status ?? ''}
          statusOptions={[...statusOptions]}
          closePath={closePath}
        />

        <TimerWithTimeEntries
          initialTaskId={ticket.everhour_task_id ?? null}
          ticketId={ticketId}
          everhourIntegration={everhourIntegration ?? null}
        />

        <div className="flex-1 overflow-y-auto overflow-x-hidden bg-muted/50 pb-10 ">
          <section className="bg-card py-5">
            <div className="px-5">
              {ticket.delegate ? (
                <div className="mb-3 flex items-center gap-1.5 text-xs text-orange-500/90">
                  <Bot className="h-3.5 w-3.5 shrink-0" />
                  <span>Created by agent: {ticket.delegate}</span>
                </div>
              ) : null}
              {ticket.source === 'slack' ? (
                <div className="mb-3 flex items-center gap-1.5 text-xs text-sky-500/90">
                  <MessageSquare className="h-3.5 w-3.5 shrink-0" />
                  <span>Created via Slack</span>
                </div>
              ) : null}
              <div className="mb-4">
                <TicketTitleField
                  ticketId={ticketId}
                  initialTitle={ticket.title ?? ''}
                  fallbackObjective={ticket.context ?? ''}
                  initialObjectives={objectives ?? []}
                  futureObjectivesEnabled={futureObjectivesEnabled}
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
                <TicketExecutionTargetSelect
                  currentExecutionTarget={ticket.execution_target ?? 'agent'}
                  ticketId={ticketId}
                />
              </div>

              {ticket.project_id ? (
                <div className="mb-4">
                  <TicketTagEditor
                    ticketId={ticketId}
                    projectId={ticket.project_id}
                    initialTags={initialTags}
                  />
                </div>
              ) : null}
            </div>
            <div className="flex flex-col pb-5">
              <TicketObjectivesSection
                ticketId={ticketId}
                organizationId={organizationId}
                objectives={objectives ?? []}
                futureObjectivesEnabled={futureObjectivesEnabled}
                objectiveAttachments={objectiveAttachments}
                objectiveFileMentionPaths={objectiveFileMentionPaths}
                workingDirectory={workingDirectory}
                assignedAgent={assignedAgent}
                projectId={activeProjectId}
                agentFlags={agentFlags}
                agentCommands={agentCommands}
                sshCommand={projectSshCommand}
                remoteWorkingDirectory={projectRemoteWorkingDirectory}
                hasProjectWorkingDirectory={hasProjectWorkingDirectory}
                checkpointsByObjectiveId={checkpointsByObjectiveId}
              />
            </div>
          </section>
          <section className="flex flex-col px-5 pt-5 ">
            <TicketToolsAndCriteria
              ticketId={ticketId}
              availableTools={ticket.available_tools}
              acceptanceCriteria={ticket.acceptance_criteria}
            />

            <ErrorBoundary>
              <TicketPanelLive
                ticketId={ticketId}
                projectId={activeProjectId}
                editorScheme={editorScheme}
                workspaceRoot={workspaceRoot}
                workingDirectory={workingDirectory}
                hasProjectWorkingDirectory={hasProjectWorkingDirectory}
              />
            </ErrorBoundary>
          </section>
        </div>
      </div>
    </TicketLiveProvider>
  );
}
