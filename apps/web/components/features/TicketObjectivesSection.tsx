'use client';

import { useMemo, useTransition } from 'react';

import { DraftObjective } from '@/components/features/DraftObjective';
import { ObjectiveCollapsibleItem } from '@/components/features/ObjectiveCollapsibleItem';
import { Button } from '@/components/ui/button';
import type { ObjectiveAttachment } from '@/lib/actions/attachments';
import { createEmptyDraftObjectiveAction } from '@/lib/actions/tickets';
import { withElectronActionRetry } from '@/lib/electron-auth/action-retry';
import type { LaunchAgentTypeValue } from '@/lib/helpers/agent-types';
import {
  parseObjectiveAssignedAgent,
  type TicketAssignedAgent
} from '@/lib/helpers/ticket-assigned-agent';
import { useTicketObjectivesRealtime } from '@/lib/hooks/use-ticket-objectives-realtime';
import { sortObjectivesByCreatedAtAscending } from '@/lib/objectives';
import type { AgentCommands } from '@/lib/overlord/launch-commands';
import type { Database } from '@/types/database.types';

const createEmptyDraftObjectiveActionWithRetry = withElectronActionRetry(
  createEmptyDraftObjectiveAction
);

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
  futureObjectivesEnabled?: boolean;
  objectiveAttachments: ObjectiveAttachment[];
  objectiveFileMentionPaths: string[];
  workingDirectory: string | null;
  assignedAgent?: TicketAssignedAgent | null;
  projectId?: string | null;
  agentFlags?: Partial<Record<LaunchAgentTypeValue, string[]>>;
  agentCommands?: AgentCommands;
  sshCommand?: string | null;
  remoteWorkingDirectory?: string | null;
  hasProjectWorkingDirectory?: boolean;
  checkpointsByObjectiveId?: Record<string, ObjectiveCheckpoint>;
};

export function TicketObjectivesSection({
  ticketId,
  organizationId,
  objectives: initialObjectives,
  futureObjectivesEnabled = false,
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

  const editableObjectives = useMemo(
    () =>
      sortObjectivesByCreatedAtAscending(
        objectives.filter(
          objective =>
            objective.state === 'draft' ||
            (futureObjectivesEnabled && objective.state === 'future') ||
            objective.state === 'submitted'
        )
      ),
    [futureObjectivesEnabled, objectives]
  );

  const lastEditable = editableObjectives[editableObjectives.length - 1];
  const hasTrailingEmptyDraft =
    (lastEditable?.state === 'draft' ||
      (futureObjectivesEnabled && lastEditable?.state === 'future')) &&
    lastEditable.objective.trim() === '';

  const [addingObjective, startAddObjective] = useTransition();

  const executedObjectives = objectives.filter(
    objective =>
      objective.state !== 'draft' &&
      (!futureObjectivesEnabled || objective.state !== 'future') &&
      objective.state !== 'submitted' &&
      objective.objective.trim().length > 0
  );
  const orderedExecutedObjectives = sortObjectivesByCreatedAtAscending(executedObjectives);

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

        {editableObjectives.length === 0 ? (
          <div className="mt-2 space-y-2">
            <p className="text-sm text-muted-foreground">No objectives yet.</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={addingObjective}
              onClick={() =>
                startAddObjective(() => void createEmptyDraftObjectiveActionWithRetry({ ticketId }))
              }
            >
              Add objective
            </Button>
          </div>
        ) : (
          <>
            <div className="space-y-3">
              {editableObjectives.map(objective => (
                <DraftObjective
                  key={objective.id}
                  canMarkExecuted={Boolean(objective.objective?.trim())}
                  fileMentionPaths={objectiveFileMentionPaths}
                  initialValue={objective.objective ?? ''}
                  initialAttachments={objectiveAttachments.filter(
                    attachment => attachment.objectiveId === objective.id
                  )}
                  objectiveId={objective.id}
                  objectiveState={objective.state}
                  ticketId={ticketId}
                  organizationId={organizationId}
                  workingDirectory={workingDirectory}
                  assignedAgent={
                    parseObjectiveAssignedAgent(objective.assigned_agent) ?? assignedAgent ?? null
                  }
                  projectId={projectId}
                  agentFlags={agentFlags}
                  agentCommands={agentCommands}
                  sshCommand={sshCommand}
                  remoteWorkingDirectory={remoteWorkingDirectory}
                  hasProjectWorkingDirectory={hasProjectWorkingDirectory}
                />
              ))}
            </div>
            <div className="mt-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={addingObjective || hasTrailingEmptyDraft}
                onClick={() =>
                  startAddObjective(
                    () => void createEmptyDraftObjectiveActionWithRetry({ ticketId })
                  )
                }
              >
                Add objective
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
