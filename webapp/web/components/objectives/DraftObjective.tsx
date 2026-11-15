import {
  objectiveHasInstructionText,
  shouldDiscardEmptiedObjective
} from '@overlord/automations/objective-manager';
import type { ExecutionRequestDto, ObjectiveDto } from '@overlord/contract';
import { ChevronDown, ChevronRight, ChevronUp } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

import { instructionLengthLabel } from '../../lib/objective-brief.ts';
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
import {
  ObjectiveSummaryBody,
  ObjectiveSummaryFallback,
  ObjectiveSummaryProse,
  SummaryMentionBadges,
  useObjectiveSummary
} from './ObjectiveSummary.tsx';

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
 *
 * When the objective has a human-facing summary (coo:1275), the body shows the
 * title, the summary prose and its provenance/actions, and the instructions sit
 * behind an "Instructions · N characters" disclosure. Without one, the body is
 * the instruction editor as before, with Summarize / pending / failure states
 * under it. The summary is presentation only: launch, Run Queue and the agent's
 * prompt still use the instructions, and nothing here waits for a model.
 *
 * Layout never remounts an editor. The instruction field keeps one position in
 * the tree whatever the layout, so a summary that arrives mid-edit, or a drag
 * that turns the head into a compact card, keeps its text and focus; the
 * summary editor's text lives in an objective-id buffer store that also
 * survives the remount when the card moves to the launching group.
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

  const bodyId = useId();
  const instructionsId = useId();
  const summary = useObjectiveSummary(objective);
  // An old summary never stands in for an empty instruction: a blank draft
  // keeps its placeholder editor and existing launch guards.
  const summaryLayout =
    (objectiveHasInstructionText(objective) && summary.view.summary !== null) || summary.editing;
  /** The person opened the "Instructions" disclosure on a summary layout. */
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  /** Focus is inside the instruction editor; it must never be hidden or clipped. */
  const [instructionEditing, setInstructionEditing] = useState(false);
  // A summary that arrives (realtime refetch) while the instruction is being
  // edited latches the disclosure open, so finishing the edit does not hide
  // the text the person was just working on.
  const previousSummaryLayout = useRef(summaryLayout);
  useEffect(() => {
    if (summaryLayout && !previousSummaryLayout.current && instructionEditing) {
      setInstructionsOpen(true);
    }
    previousSummaryLayout.current = summaryLayout;
  }, [summaryLayout, instructionEditing]);
  const collapsed = compact && !isCompactExpanded && !instructionEditing && !summary.editing;
  const instructionsVisible =
    instructionEditing || !summaryLayout || (!collapsed && instructionsOpen);

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
        compact && !collapsed && 'opacity-100',
        isLaunching && 'border-sky-400/45 bg-sky-500/5 focus-within:ring-sky-400/30'
      )}
    >
      {/* Card body. Compact queue cards collapse to a read preview: the
          instruction clipped to two lines, or — with a summary — the title and
          a two-line summary. The expand-on-focus listeners live on the two
          editors rather than the whole body so that footer controls (run
          queue, actions menu, resource/agent pickers, launch) and the Expand
          button never change the card's height. An editor in use is never
          clipped: the two-line limit applies to read previews only. */}
      <div
        id={bodyId}
        data-testid="objective-card-body"
        data-layout={compact ? (collapsed ? 'compact' : 'compact-expanded') : 'full'}
        className={cn(
          'relative px-3 pb-2 pt-3 transition-[max-height] duration-200 ease-in-out',
          compact && 'pr-9',
          collapsed && !summaryLayout && 'max-h-13 overflow-hidden',
          compact && !collapsed && 'max-h-[500px] overflow-y-auto'
        )}
      >
        {summaryLayout ? (
          <div className="mb-1 flex min-w-0 items-start gap-2">
            {objective.title ? (
              <p
                className={cn(
                  'min-w-0 flex-1 text-sm font-semibold text-foreground',
                  collapsed && 'truncate'
                )}
              >
                {objective.title}
              </p>
            ) : (
              <span className="flex-1" />
            )}
            <SummaryMentionBadges
              mentions={summary.view.mentions}
              onReveal={collapsed ? () => setIsCompactExpanded(true) : undefined}
              expanded={collapsed ? false : undefined}
              controls={collapsed ? bodyId : undefined}
            />
          </div>
        ) : null}
        {summaryLayout && collapsed ? (
          <ObjectiveSummaryProse paragraphs={summary.view.paragraphs} clamp />
        ) : null}
        {summaryLayout && !collapsed ? (
          <div
            className="mb-2"
            onFocusCapture={() => {
              if (compact) setIsCompactExpanded(true);
            }}
          >
            <ObjectiveSummaryBody
              objective={objective}
              view={summary.view}
              provenance={summary.provenance}
              editing={summary.editing}
            />
          </div>
        ) : null}
        {summaryLayout && !collapsed ? (
          <button
            type="button"
            className="mb-1 inline-flex items-center gap-1 rounded-sm text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring/60"
            aria-expanded={instructionsVisible}
            aria-controls={instructionsId}
            // Decided from what the person sees now: the click blurs an open
            // instruction editor before it lands, which would flip the result.
            onClick={() => setInstructionsOpen(!instructionsVisible)}
          >
            <ChevronRight
              className={cn('h-3 w-3 transition-transform', instructionsVisible && 'rotate-90')}
              aria-hidden="true"
            />
            <span>Instructions</span>
            <span aria-hidden="true" className="text-muted-foreground/60">
              ·
            </span>
            <span className="font-mono font-normal normal-case tracking-normal">
              {instructionLengthLabel(objective.instructionText)}
            </span>
          </button>
        ) : null}
        <div
          id={instructionsId}
          hidden={!instructionsVisible}
          className={cn(
            'text-sm leading-relaxed',
            compact && !summaryLayout && 'text-muted-foreground'
          )}
          onFocusCapture={() => {
            setInstructionEditing(true);
            if (compact) setIsCompactExpanded(true);
          }}
          onBlurCapture={event => {
            if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
            setInstructionEditing(false);
          }}
        >
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
        {!summaryLayout && !collapsed ? (
          <ObjectiveSummaryFallback objective={objective} view={summary.view} />
        ) : null}
        {compact ? (
          <button
            type="button"
            className="absolute right-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full border border-border/50 bg-background/90 text-muted-foreground shadow-sm hover:bg-background hover:text-foreground"
            aria-label={collapsed ? 'Expand objective' : 'Collapse objective'}
            aria-expanded={!collapsed}
            aria-controls={bodyId}
            onClick={() => {
              if (collapsed) {
                setIsCompactExpanded(true);
                return;
              }
              setIsCompactExpanded(false);
              (document.activeElement as HTMLElement | null)?.blur();
            }}
          >
            {collapsed ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronUp className="h-3.5 w-3.5" />
            )}
          </button>
        ) : null}
        {collapsed && !summaryLayout ? (
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
