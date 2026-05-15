'use client';

import { Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';

import { AddTicketObjectiveButton } from '@/components/features/AddTicketObjectiveButton';
import { DraftObjective } from '@/components/features/DraftObjective';
import { ObjectiveCollapsibleItem } from '@/components/features/ObjectiveCollapsibleItem';
import { type ButtonLoadingState, LoadingButton } from '@/components/ui/loading-button';
import type { ObjectiveAttachment } from '@/lib/actions/attachments';
import type { LaunchAgentTypeValue } from '@/lib/helpers/agent-types';
import {
  parseObjectiveAssignedAgent,
  type TicketAssignedAgent
} from '@/lib/helpers/ticket-assigned-agent';
import { useTicketObjectivesRealtime } from '@/lib/hooks/use-ticket-objectives-realtime';
import { sortObjectivesByCreatedAtAscending } from '@/lib/objectives';
import type { AgentCommands } from '@/lib/overlord/launch-commands';
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
  allProjectCheckpointObjectiveIds?: string[];
  gitRevertFeatureEnabled?: boolean;
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
  checkpointsByObjectiveId,
  allProjectCheckpointObjectiveIds = [],
  gitRevertFeatureEnabled = false
}: TicketObjectivesSectionProps) {
  const [pruneState, setPruneState] = useState<ButtonLoadingState>('default');
  const [pruneMessage, setPruneMessage] = useState<string | null>(null);
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

  const hasAnyDraftObjective = useMemo(
    () => objectives.some(objective => objective.state === 'draft'),
    [objectives]
  );

  const executedObjectives = objectives.filter(
    objective =>
      objective.state !== 'draft' &&
      (!futureObjectivesEnabled || objective.state !== 'future') &&
      objective.state !== 'submitted' &&
      objective.objective.trim().length > 0
  );
  const orderedExecutedObjectives = sortObjectivesByCreatedAtAscending(executedObjectives);

  async function handlePruneCheckpoints() {
    if (!workingDirectory) {
      setPruneState('error');
      setPruneMessage('No working directory is configured for this project.');
      return;
    }
    const pruneCheckpoints = window.electronAPI?.filesystem?.pruneCheckpoints;
    if (!pruneCheckpoints) {
      setPruneState('error');
      setPruneMessage('Checkpoint cleanup is only available in the Overlord desktop app.');
      return;
    }

    setPruneState('loading');
    setPruneMessage(null);
    try {
      const result = await pruneCheckpoints({
        directory: workingDirectory,
        keepObjectiveIds: allProjectCheckpointObjectiveIds
      });
      if (!result.ok) {
        setPruneState('error');
        setPruneMessage(result.error ?? 'Failed to prune checkpoints.');
        return;
      }
      setPruneState('success');
      setPruneMessage(
        result.pruned.length > 0
          ? `Pruned ${result.pruned.length} stale checkpoint ref${result.pruned.length === 1 ? '' : 's'}.`
          : 'No stale checkpoint refs found.'
      );
    } catch (error) {
      setPruneState('error');
      setPruneMessage(error instanceof Error ? error.message : 'Failed to prune checkpoints.');
    }
  }

  return (
    <div className="flex flex-col pb-5">
      <div className="px-5">
        {orderedExecutedObjectives.length > 0 ? (
          <>
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
                  gitRevertFeatureEnabled={gitRevertFeatureEnabled}
                  workingDirectory={workingDirectory}
                />
              ))}
            </div>
            {gitRevertFeatureEnabled ? (
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <LoadingButton
                  buttonState={pruneState}
                  setButtonState={setPruneState}
                  reset={true}
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 px-2 text-[11px] text-muted-foreground"
                  text={
                    <>
                      <Trash2 className="h-3 w-3" />
                      Prune stale checkpoints
                    </>
                  }
                  loadingText="Pruning..."
                  successText="Pruned"
                  errorText="Prune failed"
                  disabled={!workingDirectory}
                  onClick={handlePruneCheckpoints}
                />
                {pruneMessage ? (
                  <p className="text-[11px] text-muted-foreground">{pruneMessage}</p>
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}

        {editableObjectives.length === 0 ? (
          <div className="mt-2 space-y-2">
            <p className="text-sm text-muted-foreground">No objectives yet.</p>
            <AddTicketObjectiveButton
              ticketId={ticketId}
              futureObjectivesEnabled={futureObjectivesEnabled}
            />
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
              <AddTicketObjectiveButton
                futureObjectivesEnabled={futureObjectivesEnabled}
                disabled={
                  hasTrailingEmptyDraft || (!futureObjectivesEnabled && hasAnyDraftObjective)
                }
                ticketId={ticketId}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
