'use client';

import { InlineEditField } from '@/components/features/InlineEditField';
import { ObjectiveCollapsibleItem } from '@/components/features/ObjectiveCollapsibleItem';
import { ObjectiveMenuButton } from '@/components/features/ObjectiveMenuButton';
import { useTicketObjectivesRealtime } from '@/lib/hooks/use-ticket-objectives-realtime';
import { sortObjectivesByCreatedAtAscending } from '@/lib/objectives';
import type { Database } from '@/types/database.types';

type ObjectiveRow = Pick<
  Database['public']['Tables']['objectives']['Row'],
  | 'id'
  | 'objective'
  | 'is_executed'
  | 'created_at'
  | 'title'
  | 'state'
  | 'agent_identifier'
  | 'model_identifier'
>;

type TicketObjectivesSectionProps = {
  ticketId: string;
  organizationId: number;
  objectives: ObjectiveRow[];
  objectiveFileMentionPaths: string[];
  workingDirectory: string | null;
  sshCommand?: string | null;
  remoteWorkingDirectory?: string | null;
};

export function TicketObjectivesSection({
  ticketId,
  organizationId,
  objectives: initialObjectives,
  objectiveFileMentionPaths,
  workingDirectory,
  sshCommand,
  remoteWorkingDirectory
}: TicketObjectivesSectionProps) {
  const objectives = useTicketObjectivesRealtime({
    ticketId,
    initialObjectives
  });

  const draftObjective = objectives.find(objective => !objective.is_executed) ?? null;
  const executedObjectives = objectives.filter(
    objective => objective.is_executed && objective.objective.trim().length > 0
  );
  const orderedExecutedObjectives = sortObjectivesByCreatedAtAscending(executedObjectives);
  const draftObjectiveValue = draftObjective?.objective ?? '';

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
                  index === orderedExecutedObjectives.length - 1 && !draftObjectiveValue.trim()
                }
              />
            ))}
          </div>
        ) : null}

        <div className="flex w-full items-start gap-1">
          <InlineEditField
            key={draftObjective?.id ?? 'current-objective'}
            displayClassName="text-base leading-relaxed"
            field="objective"
            initialValue={draftObjectiveValue}
            inputClassName="text-base leading-relaxed"
            multiline
            organizationId={organizationId}
            placeholder="Click to add an objective…"
            renderMarkdown
            ticketId={ticketId}
            variant="textarea"
            fileMentionPaths={objectiveFileMentionPaths}
            workingDirectory={workingDirectory}
            sshCommand={sshCommand}
            remoteWorkingDirectory={remoteWorkingDirectory}
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
      </div>
    </div>
  );
}
