'use client';

import { InlineEditField } from '@/components/features/InlineEditField';
import { ObjectiveMenuButton } from '@/components/features/ObjectiveMenuButton';

type DraftObjectiveProps = {
  ticketId: string;
  organizationId: number;
  objectiveId: string;
  objectiveState: string | null;
  initialValue: string;
  canMarkExecuted: boolean;
  fileMentionPaths: string[];
  workingDirectory: string | null;
};

export function DraftObjective({
  ticketId,
  organizationId,
  objectiveId,
  objectiveState,
  initialValue,
  canMarkExecuted,
  fileMentionPaths,
  workingDirectory
}: DraftObjectiveProps) {
  return (
    <div className="flex w-full items-start gap-3">
      <InlineEditField
        displayClassName="text-base leading-relaxed"
        field="objective"
        fileMentionPaths={fileMentionPaths}
        initialValue={initialValue}
        inputClassName="text-base leading-relaxed"
        multiline
        organizationId={organizationId}
        placeholder="Click to add an objective…"
        renderMarkdown
        ticketId={ticketId}
        variant="textarea"
        workingDirectory={workingDirectory}
      >
        <ObjectiveMenuButton
          canMarkExecuted={canMarkExecuted}
          objectiveId={objectiveId}
          state={objectiveState}
          ticketId={ticketId}
        />
      </InlineEditField>
    </div>
  );
}
