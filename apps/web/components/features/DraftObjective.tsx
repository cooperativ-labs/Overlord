'use client';

import { AtSign } from 'lucide-react';
import { useRef } from 'react';

import { InlineEditField, type InlineEditFieldHandle } from '@/components/features/InlineEditField';
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
  const editFieldRef = useRef<InlineEditFieldHandle>(null);

  return (
    <div className="w-full overflow-hidden rounded-xl border border-border/60 transition-all focus-within:ring-1 focus-within:ring-ring/40">
      {workingDirectory ? (
        <div className="px-3 pt-3 pb-1">
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-full border border-border/50 bg-muted/40 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
            onClick={() => editFieldRef.current?.triggerAtMention()}
          >
            <AtSign className="h-3.5 w-3.5" />
            Add context
          </button>
        </div>
      ) : null}
      <InlineEditField
        ref={editFieldRef}
        displayClassName="text-base leading-relaxed"
        field="objective"
        fileMentionPaths={fileMentionPaths}
        initialValue={initialValue}
        inputClassName="text-base leading-relaxed"
        multiline
        placeholder="Click to add an objective…"
        renderMarkdown
        seamless
        ticketId={ticketId}
        variant="textarea"
        workingDirectory={workingDirectory}
      />
      <div className="border-t border-border/40">
        <ObjectiveAttachmentUpload
          toolbar
          ticketId={ticketId}
          objectiveId={objectiveId}
          initialAttachments={initialAttachments}
        >
          <ObjectiveMenuButton
            canMarkExecuted={canMarkExecuted}
            objectiveId={objectiveId}
            state={objectiveState}
            ticketId={ticketId}
          />
        </ObjectiveAttachmentUpload>
      </div>
    </div>
  );
}
