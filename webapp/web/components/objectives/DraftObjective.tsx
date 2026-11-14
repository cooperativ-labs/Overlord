import { shouldDiscardEmptiedObjective } from '@overlord/automations/objective-manager';
import type { ExecutionRequestDto, ObjectiveDto } from '@overlord/contract';
import { ChevronUp } from 'lucide-react';
import { useState } from 'react';

import {
  type ObjectiveEvidence,
  type ObjectiveEvidenceTruncation,
  objectiveHasHistory
} from '../../lib/objective-evidence.ts';
import {
  useDeleteObjective,
  useObjectiveFileChanges,
  useUpdateObjective
} from '../../lib/queries.ts';
import { useRepositoryMentionOptions } from '../../lib/useRepositoryMentionOptions.ts';
import { cn } from '../../lib/utils.ts';
import { InlineEditField } from '../InlineEditField.tsx';
import { FileDropZone } from '../ui/file-drop-zone.tsx';

import { DraftObjectiveToolbar } from './DraftObjectiveToolbar.tsx';
import {
  ObjectiveAttachmentList,
  ObjectiveAttachmentUploadTrigger,
  useObjectiveAttachmentState
} from './ObjectiveAttachments.tsx';
import type { ObjectiveEvidenceLoading } from './ObjectiveEvidenceSections.tsx';
import { ObjectiveHistoryStrip } from './ObjectiveHistoryStrip.tsx';

type DraftObjectiveProps = {
  objective: ObjectiveDto;
  /** All objectives on the mission — used to detect an already-active sibling. */
  siblings: ObjectiveDto[];
  /** Active execution requests for the mission (from MissionDetailDto). */
  executionRequests: ExecutionRequestDto[];
  allowParallelObjectives?: boolean;
  /**
   * What this objective produced in earlier runs, when it was completed and
   * then set back to draft (coo:879 §4.5). Renders the read-only "Previous
   * runs" strip and stops an emptied instruction from deleting the objective
   * out from under that history. Omitted on surfaces with no evidence to show.
   */
  evidence?: ObjectiveEvidence;
  evidenceLoading?: ObjectiveEvidenceLoading;
  evidenceTruncation?: ObjectiveEvidenceTruncation;
  /**
   * Render as a compact queue card (collapsed until its instruction is focused)
   * instead of the full launch card. The mission panel passes this by queue
   * index — the queue head is full, the rest compact — so dragging a card to
   * the top expands it while the same component instance (keyed by objective
   * id) keeps its editor state, pending uploads and unsaved text.
   */
  compact?: boolean;
};

/**
 * One objective card with the launch surface: state-aware styling, inline
 * instruction editing, Run Queue control, agent/model chooser, and the
 * split run button. Every queued objective launches directly; compact cards
 * differ only in layout.
 */
export function DraftObjective({
  objective,
  siblings,
  executionRequests,
  allowParallelObjectives = false,
  evidence,
  evidenceLoading = { deliveries: false },
  evidenceTruncation,
  compact = false
}: DraftObjectiveProps) {
  const update = useUpdateObjective();
  const remove = useDeleteObjective();
  const { mentionPaths, projectMentionOptions, missionMentionOptions } =
    useRepositoryMentionOptions(objective.projectId, objective.resourceKey);
  const [isCompactExpanded, setIsCompactExpanded] = useState(false);
  const {
    attachments,
    error: attachmentError,
    removingId,
    isUploading,
    inputRef,
    handleFiles,
    handleInputChange,
    handleRemove,
    dragState
  } = useObjectiveAttachmentState(objective.id);
  const isLaunching = objective.state === 'launching';
  // Only an objective that already ran can have file evidence behind it.
  const fileChangesQuery = useObjectiveFileChanges(objective.missionId, objective.id, {
    enabled: evidence !== undefined && objective.startedAt !== null
  });
  const fileCount = fileChangesQuery.data?.total ?? 0;
  const hasHistory = objectiveHasHistory(evidence, fileCount);

  return (
    <FileDropZone
      onDrop={handleFiles}
      disabled={isUploading}
      dragState={dragState}
      className={cn(
        'w-full overflow-hidden rounded-xl border transition-all focus-within:shadow-md focus-within:ring-1 focus-within:ring-ring/50 md:min-w-[350px]',
        compact
          ? 'border-border/50 bg-muted/20 opacity-70 focus-within:opacity-100'
          : 'border-muted-foreground/20',
        isLaunching && 'border-sky-400/45 bg-sky-500/5 focus-within:ring-sky-400/30'
      )}
    >
      {/* Instruction body — compact queue cards collapse until the instruction
          text itself is focused. The expand-on-focus listener lives on this
          body rather than the whole card so that footer controls (run queue,
          actions menu, resource/agent pickers, launch) never change the
          card's height: focusing them — or the popovers they open — must
          neither expand a collapsed card nor collapse an expanded one. */}
      <div
        className={cn(
          'relative px-3 pb-2 pt-3 transition-[max-height] duration-200 ease-in-out',
          compact && !isCompactExpanded && 'max-h-13 overflow-hidden',
          compact && isCompactExpanded && 'max-h-[500px] overflow-y-auto'
        )}
        onFocusCapture={() => {
          if (compact) setIsCompactExpanded(true);
        }}
      >
        <div className={cn('text-sm leading-relaxed', compact && 'text-muted-foreground')}>
          <InlineEditField
            multiline
            value={objective.instructionText}
            className="text-base text-foreground/90 font-medium whitespace-pre-wrap"
            inputClassName="text-base text-foreground/90 font-medium whitespace-pre-wrap"
            // Always set a minimum so the display span and the editor share
            // the same box (min-height, block layout, 360px cap). A footer
            // click blurs the editor and commits back to display mode; without
            // parity that swap shrank one-line and very long objectives.
            minRows={objective.state === 'draft' && !compact ? 2 : 1}
            placeholder="Describe what the agent should do… (@ file, # project, $ mission)"
            ariaLabel="Objective instruction"
            commitEmpty={objective.state === 'draft'}
            mentionPaths={mentionPaths}
            projectMentionOptions={projectMentionOptions}
            missionMentionOptions={missionMentionOptions}
            onSave={instructionText => {
              // An emptied draft objective is no longer work, so it
              // deletes itself rather than lingering as a blank row. Empty
              // saves only arrive when the edit finishes (see `commitEmpty` in
              // InlineEditField), so clearing the field to retype does not
              // delete the card mid-edit.
              if (
                shouldDiscardEmptiedObjective(
                  { ...objective, instructionText },
                  { attachmentCount: attachments.length, hasHistory }
                )
              ) {
                remove.mutate(objective.id);
                return;
              }
              update.mutate({ id: objective.id, body: { instructionText } });
            }}
          />
        </div>
        {compact && isCompactExpanded ? (
          <button
            type="button"
            className="absolute right-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full border border-border/50 bg-background/90 text-muted-foreground shadow-sm hover:bg-background hover:text-foreground"
            aria-label="Collapse objective"
            onClick={() => {
              setIsCompactExpanded(false);
              (document.activeElement as HTMLElement | null)?.blur();
            }}
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </button>
        ) : null}
        {compact && !isCompactExpanded ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-linear-to-t from-background/80 to-transparent" />
        ) : null}
      </div>

      {hasHistory && evidence ? (
        <ObjectiveHistoryStrip
          objective={objective}
          evidence={evidence}
          fileCount={fileCount}
          loading={evidenceLoading}
          truncation={evidenceTruncation}
        />
      ) : null}

      {/* Attachments + toolbar. The whole card is the drop target (FileDropZone);
          the footer + button opens the file browser. */}
      <div className="border-t border-border/40">
        <ObjectiveAttachmentList
          attachments={attachments}
          removingId={removingId}
          onRemove={handleRemove}
          toolbar
        />
        {attachmentError ? (
          <p className="px-3 pb-1 text-xs text-destructive">{attachmentError}</p>
        ) : null}
        <ObjectiveAttachmentUploadTrigger
          attachmentsCount={attachments.length}
          inputRef={inputRef}
          onInputChange={handleInputChange}
          disabled={isUploading}
        >
          <DraftObjectiveToolbar
            objective={objective}
            siblings={siblings}
            executionRequests={executionRequests}
            allowParallelObjectives={allowParallelObjectives}
          />
        </ObjectiveAttachmentUploadTrigger>
      </div>
    </FileDropZone>
  );
}
