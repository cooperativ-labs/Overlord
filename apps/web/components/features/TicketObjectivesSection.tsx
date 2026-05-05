'use client';

import { DraftObjective } from '@/components/features/DraftObjective';
import { ObjectiveCollapsibleItem } from '@/components/features/ObjectiveCollapsibleItem';
import { useTicketObjectivesRealtime } from '@/lib/hooks/use-ticket-objectives-realtime';
import { sortObjectivesByCreatedAtAscending } from '@/lib/objectives';
import type { Database } from '@/types/database.types';

type ObjectiveRow = Pick<
  Database['public']['Tables']['objectives']['Row'],
  'id' | 'objective' | 'created_at' | 'title' | 'state' | 'agent_identifier' | 'model_identifier'
>;

type TicketObjectivesSectionProps = {
  ticketId: string;
  organizationId: number;
  objectives: ObjectiveRow[];
  objectiveFileMentionPaths: string[];
  workingDirectory: string | null;
};

export function TicketObjectivesSection({
  ticketId,
  organizationId,
  objectives: initialObjectives,
  objectiveFileMentionPaths,
  workingDirectory
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
                isLatest={
                  index === orderedExecutedObjectives.length - 1 && !editableObjectiveValue.trim()
                }
              />
            ))}
          </div>
        ) : null}

        <DraftObjective
          key={editableObjective?.id ?? 'current-objective'}
          canMarkExecuted={Boolean(editableObjective?.objective?.trim())}
          fileMentionPaths={objectiveFileMentionPaths}
          initialValue={editableObjectiveValue}
          objectiveId={editableObjective?.id ?? ''}
          objectiveState={editableObjective?.state ?? 'complete'}
          organizationId={organizationId}
          ticketId={ticketId}
          workingDirectory={workingDirectory}
        />
      </div>
    </div>
  );
}
