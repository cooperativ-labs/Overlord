import { X } from 'lucide-react';
import Link from 'next/link';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { CopyTicketPromptButton } from '@/components/features/CopyTicketPromptButton';
import { DeleteTicketButton } from '@/components/features/DeleteTicketButton';
import { TimerWithTimeEntries } from '@/components/features/everhour/TimerWithTimeEntries';
import { InlineEditField } from '@/components/features/InlineEditField';
import { LaunchCommandBar } from '@/components/features/LaunchCommandBar';
import { TicketExecutionTargetSelect } from '@/components/features/TicketExecutionTargetSelect';
import { TicketPanelLive } from '@/components/features/TicketPanelLive';
import { TicketProjectSelect } from '@/components/features/TicketProjectSelect';
import { TicketStatusSelect } from '@/components/features/TicketStatusSelect';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { getAgentApiToken, getEditorScheme, getPlatformUrl, getWorkspaceRoot } from '@/lib/env';
import { getTicketIdentifier } from '@/lib/helpers/tickets';
import { buildLaunchCommands } from '@/lib/overlord/launch-commands';
import { createClient } from '@/supabase/utils/server';

const fallbackStatuses = ['draft', 'execute', 'review', 'deliver', 'complete', 'blocked'] as const;

function resolveWorkingDirectory(value: string | null | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;

  let resolved = raw;
  const home = os.homedir();

  if (raw === '~') {
    resolved = home;
  } else if (raw.startsWith('~/')) {
    resolved = path.join(home, raw.slice(2));
  } else if (!path.isAbsolute(raw)) {
    resolved = path.resolve(raw);
  }

  const normalized = path.normalize(resolved);
  return fs.existsSync(normalized) ? normalized : null;
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
    { data: projects },
    { data: agentSession }
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
      .select('id,name,color,everhour_project_id,local_working_directory')
      .eq('organization_id', organizationId)
      .order('name', { ascending: true }),
    supabase
      .from('agent_sessions')
      .select('*')
      .eq('ticket_id', ticketId)
      .order('attached_at', { ascending: false })
      .limit(1)
      .maybeSingle()
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
  const { claudeCode, codex } = buildLaunchCommands({
    platformUrl,
    ticketId,
    token: agentToken
  });
  const ticketIdentifier = getTicketIdentifier(ticket.id);
  const chatGptLink = `https://chat.openai.com/?q=${encodeURIComponent(`attach ${ticketIdentifier}`)}`;
  const statusOptions = statuses?.map(s => s.name) ?? fallbackStatuses;
  const hasEverhourIntegration = Boolean(everhourIntegration?.id);
  const projectOptions = projects ?? [];
  const projectWorkingDirectory = projectOptions.find(
    project => project.id === ticket.project_id
  )?.local_working_directory;
  const workingDirectory =
    resolveWorkingDirectory(projectWorkingDirectory) ?? resolveWorkingDirectory(workspaceRoot);

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
            <CopyTicketPromptButton ticketId={ticketId} runInTerminal={false} variant="default" />
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
          currentProjectId={ticket.project_id}
          projects={projectOptions}
        />

        <LaunchCommandBar
          ticketId={ticketId}
          chatGptLink={chatGptLink}
          claudeCommand={claudeCode}
          codexCommand={codex}
          workingDirectory={workingDirectory}
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

        <TicketPanelLive
          ticketId={ticketId}
          initialEvents={events ?? []}
          initialArtifacts={artifacts ?? []}
          initialSession={agentSession ?? null}
          initialState={state ?? []}
          editorScheme={editorScheme}
          workspaceRoot={workspaceRoot}
          workingDirectory={workingDirectory}
        />
      </div>
    </div>
  );
}
