'use client';

import { InlineEditField } from '@/components/features/InlineEditField';
import { ObjectiveAttachmentUpload } from '@/components/features/ObjectiveAttachmentUpload';
import { ObjectiveMenuButton } from '@/components/features/ObjectiveMenuButton';
import type { ObjectiveAttachment } from '@/lib/actions/attachments';

type DraftObjectiveProps = {
  ticketId: string;
  objectiveId: string;
  objectiveState: string | null;
  initialValue: string;
  canMarkExecuted: boolean;
  fileMentionPaths: string[];
  initialAttachments: ObjectiveAttachment[];
  workingDirectory: string | null;
};

export function DraftObjective({
  ticketId,
  objectiveId,
  objectiveState,
  initialValue,
  canMarkExecuted,
  fileMentionPaths,
  initialAttachments,
  workingDirectory
}: DraftObjectiveProps) {
  return (
    <div className="flex w-full flex-col">
      <InlineEditField
        displayClassName="text-base leading-relaxed"
        field="objective"
        fileMentionPaths={fileMentionPaths}
        initialValue={initialValue}
        inputClassName="text-base leading-relaxed"
        multiline
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
      <ObjectiveAttachmentUpload
        ticketId={ticketId}
        objectiveId={objectiveId}
        initialAttachments={initialAttachments}
      />
    </div>
  );
}
