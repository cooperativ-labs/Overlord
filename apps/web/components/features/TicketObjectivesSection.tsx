'use client';

import { DraftObjective } from '@/components/features/DraftObjective';
import { ObjectiveCollapsibleItem } from '@/components/features/ObjectiveCollapsibleItem';
import type { ObjectiveAttachment } from '@/lib/actions/attachments';
import type { LaunchAgentTypeValue } from '@/lib/helpers/agent-types';
import {
  parseObjectiveAssignedAgent,
  type TicketAssignedAgent
} from '@/lib/helpers/ticket-assigned-agent';
import { useTicketObjectivesRealtime } from '@/lib/hooks/use-ticket-objectives-realtime';
import { sortObjectivesByCreatedAtAscending } from '@/lib/objectives';
import type { Database } from '@/types/database.types';

type ObjectiveRow = Pick<
  Database['public']['Tables']['objectives']['Row'],
  | 'id'
  | 'objective'
  | 'created_at'
  | 'title'
  | 'state'
  | 'agent_identifier'
  | 'model_identifier'
  | 'assigned_agent'
>;

type ObjectiveCheckpoint = {
  git_ref_name: string | null;
  git_commit_id: string | null;
  checkpoint_kind: string;
};

type TicketObjectivesSectionProps = {
  ticketId: string;
  organizationId?: number;
  objectives: ObjectiveRow[];
  objectiveAttachments: ObjectiveAttachment[];
  objectiveFileMentionPaths: string[];
  workingDirectory: string | null;
  assignedAgent?: TicketAssignedAgent | null;
  projectId?: string | null;
  agentFlags?: Partial<Record<LaunchAgentTypeValue, string[]>>;
  agentCommands?: Record<LaunchAgentTypeValue, string>;
  sshCommand?: string | null;
  remoteWorkingDirectory?: string | null;
  hasProjectWorkingDirectory?: boolean;
  checkpointsByObjectiveId?: Record<string, ObjectiveCheckpoint>;
};

export function TicketObjectivesSection({
  ticketId,
  organizationId,
  objectives: initialObjectives,
  objectiveAttachments,
  objectiveFileMentionPaths,
  workingDirectory,
  assignedAgent,
  projectId,
  agentFlags,
  agentCommands,
  sshCommand,
  remoteWorkingDirectory,
  hasProjectWorkingDirectory,
  checkpointsByObjectiveId
}: TicketObjectivesSectionProps) {
  const objectives = useTicketObjectivesRealtime({
    ticketId,
    initialObjectives
  });

  const editableObjective =
    objectives.find(objective => objective.state === 'draft') ??
    objectives.find(objective => objective.state === 'submitted') ??
    null;
  const executedObjectives = objectives.filter(
    objective =>
      objective.state !== 'draft' &&
      objective.state !== 'submitted' &&
      objective.objective.trim().length > 0
  );
  const orderedExecutedObjectives = sortObjectivesByCreatedAtAscending(executedObjectives);
  const editableObjectiveValue = editableObjective?.objective ?? '';
  const editableObjectiveAssignedAgent = editableObjective
    ? parseObjectiveAssignedAgent(editableObjective.assigned_agent)
    : assignedAgent;

  return (
    <div className="flex flex-col pb-5">
      <div className="px-5">
        {orderedExecutedObjectives.length > 0 ? (
          <div className="mb-3 space-y-2 rounded-md border bg-background">
            {orderedExecutedObjectives.map((objective, index) => (
              <ObjectiveCollapsibleItem
                key={objective.id}
                objective={objective}
                index={index}
                ticketId={ticketId}
                attachments={objectiveAttachments.filter(
                  attachment => attachment.objectiveId === objective.id
                )}
                checkpoint={checkpointsByObjectiveId?.[objective.id] ?? null}
              />
            ))}
          </div>
        ) : null}

        <DraftObjective
          key={editableObjective?.id ?? 'current-objective'}
          canMarkExecuted={Boolean(editableObjective?.objective?.trim())}
          fileMentionPaths={objectiveFileMentionPaths}
          initialValue={editableObjectiveValue}
          initialAttachments={objectiveAttachments.filter(
            attachment => attachment.objectiveId === editableObjective?.id
          )}
          objectiveId={editableObjective?.id ?? ''}
          objectiveState={editableObjective?.state ?? 'complete'}
          ticketId={ticketId}
          organizationId={organizationId}
          workingDirectory={workingDirectory}
          assignedAgent={editableObjectiveAssignedAgent}
          projectId={projectId}
          agentFlags={agentFlags}
          agentCommands={agentCommands}
          sshCommand={sshCommand}
          remoteWorkingDirectory={remoteWorkingDirectory}
          hasProjectWorkingDirectory={hasProjectWorkingDirectory}
        />
      </div>
    </div>
  );
}
