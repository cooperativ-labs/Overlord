import type { ObjectiveDto } from '@overlord/contract';
import { AlertTriangle, Loader2, MessageSquareQuote } from 'lucide-react';
import { type KeyboardEvent, type ReactNode, useEffect, useRef } from 'react';

import { ApiRequestError } from '../../lib/api/request.ts';
import {
  mentionBadgeLabel,
  type ObjectiveSummaryView,
  objectiveSummaryView,
  SUMMARY_MAX_CHARACTERS,
  SUMMARY_TARGET_WORDS,
  summaryCodeSegments,
  summaryFailureMessage,
  summaryMarkerSegments,
  type SummaryMentions,
  summaryProvenanceLabel,
  summaryWordCount
} from '../../lib/objective-brief.ts';
import { markEscapeConsumed } from '../../lib/objective-edit-buffers.ts';
import {
  clearSummaryBuffer,
  setSummaryBuffer,
  updateSummaryBuffer,
  useSummaryBuffer
} from '../../lib/objective-summary-buffers.ts';
import {
  useRequestObjectiveDescription,
  useUpdateObjectiveDescription,
  useWorkspaceMembers
} from '../../lib/queries.ts';
import { cn } from '../../lib/utils.ts';

/**
 * The human-facing summary of an objective (coo:1275, plan §4.12): prose, the provenance
 * and status line, Summarize / Regenerate / Retry / Remove, and the person's editor.
 *
 * Presentation only. Nothing here touches `instructionText`, lifecycle, the Run Queue or
 * launch: every write is a description PATCH or a description request, which the server
 * keeps out of `updatedAt`, notifications and the executing agent's context (ADR 0059).
 */

/** Hook: the derived view plus the provenance line for one objective. */
export function useObjectiveSummary(objective: ObjectiveDto) {
  const view = objectiveSummaryView(objective);
  // Members are only needed to name a person's edit; skip the read otherwise.
  const needsMembers = objective.descriptionSource === 'user' && view.summary !== null;
  const members = useWorkspaceMembers(needsMembers ? objective.workspaceId : null);
  const provenance = summaryProvenanceLabel(objective, members.data);
  const buffer = useSummaryBuffer(objective.id);
  return { view, provenance, editing: buffer !== undefined };
}

/** Renders stored prose as text paragraphs; the two STE markers are emphasised, never parsed as HTML. */
export function ObjectiveSummaryProse({
  paragraphs,
  clamp = false,
  id,
  className
}: {
  paragraphs: string[];
  /** Two-line read preview for a collapsed compact card. */
  clamp?: boolean;
  id?: string;
  className?: string;
}) {
  return (
    <div
      id={id}
      data-testid="objective-summary-prose"
      className={cn(
        'min-w-0 text-sm leading-relaxed text-foreground/90 wrap-anywhere',
        clamp ? 'line-clamp-2' : 'grid gap-2',
        className
      )}
    >
      {paragraphs.map((paragraph, index) => (
        <p key={index} className={clamp ? 'inline' : undefined}>
          {summaryMarkerSegments(paragraph).map((segment, segmentIndex) =>
            segment.marker ? (
              <strong
                key={segmentIndex}
                className={cn(
                  'font-semibold',
                  segment.marker === 'caution'
                    ? 'text-amber-700 dark:text-amber-300'
                    : 'text-foreground'
                )}
              >
                {segment.text}
              </strong>
            ) : (
              <span key={segmentIndex}>
                {summaryCodeSegments(segment.text).map((part, partIndex) =>
                  part.code ? (
                    <code key={partIndex} className="code-inline">
                      {part.text}
                    </code>
                  ) : (
                    <span key={partIndex}>{part.text}</span>
                  )
                )}
              </span>
            )
          )}
          {clamp && index < paragraphs.length - 1 ? ' ' : null}
        </p>
      ))}
    </div>
  );
}

const BADGE_CLASS =
  'inline-flex h-5 shrink-0 items-center gap-1 rounded-sm border px-1.5 text-[11px] leading-none';
const BADGE_TONE = {
  decision: 'border-sky-500/40 text-sky-700 dark:text-sky-300',
  caution: 'border-amber-500/50 text-amber-700 dark:text-amber-300'
} as const;

/**
 * "Decision" / "Caution" mention badges. They say the summary *mentions* a decision or a
 * caution — not that one is unresolved, and their absence never means the instructions
 * carry no risk. With `onReveal` they are buttons that open the complete summary (a
 * collapsed compact card or a closed executed row); otherwise plain labels.
 */
export function SummaryMentionBadges({
  mentions,
  kinds = ['decision', 'caution'],
  onReveal,
  expanded,
  controls
}: {
  mentions: SummaryMentions;
  kinds?: ReadonlyArray<'decision' | 'caution'>;
  onReveal?: () => void;
  /** Expanded state of the region the badges open, for `aria-expanded`. */
  expanded?: boolean;
  controls?: string;
}) {
  const items = kinds
    .map(kind => ({ kind, count: kind === 'decision' ? mentions.decisions : mentions.cautions }))
    .filter(item => item.count > 0);
  if (items.length === 0) return null;
  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      {items.map(({ kind, count }) => {
        const label = mentionBadgeLabel(kind, count);
        const accessibleName = `Summary mentions ${label}`;
        const content = (
          <>
            {kind === 'caution' ? (
              <AlertTriangle className="h-3 w-3" aria-hidden="true" />
            ) : (
              <MessageSquareQuote className="h-3 w-3" aria-hidden="true" />
            )}
            <span>{label}</span>
          </>
        );
        return onReveal ? (
          <button
            key={kind}
            type="button"
            className={cn(BADGE_CLASS, BADGE_TONE[kind], 'hover:bg-muted/60')}
            aria-label={`${accessibleName}. Show the summary`}
            aria-expanded={expanded}
            aria-controls={controls}
            title={`${accessibleName}. Show the summary`}
            onClick={event => {
              event.stopPropagation();
              onReveal();
            }}
          >
            {content}
          </button>
        ) : (
          <span
            key={kind}
            className={cn(BADGE_CLASS, BADGE_TONE[kind])}
            title={accessibleName}
            aria-label={accessibleName}
            role="img"
          >
            {content}
          </span>
        );
      })}
    </span>
  );
}

function ActionButton({
  children,
  onClick,
  disabled,
  label
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      className="rounded-sm text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-ring/60 disabled:pointer-events-none disabled:opacity-50"
      onClick={event => {
        event.stopPropagation();
        onClick();
      }}
      disabled={disabled}
      aria-label={label}
    >
      {children}
    </button>
  );
}

function Separator() {
  return (
    <span aria-hidden="true" className="text-muted-foreground/50">
      ·
    </span>
  );
}

function actionErrorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) {
    switch (error.code) {
      case 'description_not_eligible':
        return 'These instructions are too short to summarize.';
      case 'description_not_failed':
        return 'There is no failed summary to retry.';
      case 'description_too_long':
        return `A summary can have at most ${SUMMARY_MAX_CHARACTERS.toLocaleString('en-US')} characters.`;
      default:
        return error.message;
    }
  }
  return 'The summary action failed. Try again.';
}

/** Summarize / Regenerate / Retry / Remove for one objective, with a shared error. */
function useSummaryActions(objective: ObjectiveDto, view: ObjectiveSummaryView) {
  const request = useRequestObjectiveDescription();
  const update = useUpdateObjectiveDescription();
  const busy = request.isPending || update.isPending;
  const error = request.error ?? update.error;
  return {
    busy,
    error: error ? actionErrorMessage(error) : null,
    summarize: () => request.mutate({ id: objective.id, mode: 'summarize' }),
    regenerate: () => request.mutate({ id: objective.id, mode: 'regenerate' }),
    retry: () => request.mutate({ id: objective.id, mode: 'retry' }),
    // Remove is durable: the server keeps the summary absent, across edits, catch-up and
    // late generation results, until a person selects Summarize.
    remove: () => update.mutate({ id: objective.id, description: null }),
    edit: () =>
      setSummaryBuffer(objective.id, { text: view.summary ?? '', baseRevision: view.revision })
  };
}

/**
 * Provenance, status and actions under an existing summary:
 * "AI summary · Edit · Regenerate · Remove", then any stale / pending / failed line.
 */
export function ObjectiveSummaryControls({
  objective,
  view,
  provenance
}: {
  objective: ObjectiveDto;
  view: ObjectiveSummaryView;
  provenance: string | null;
}) {
  const actions = useSummaryActions(objective, view);
  return (
    <div className="grid gap-0.5" data-testid="objective-summary-controls">
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
        {provenance ? <span>{provenance}</span> : null}
        {provenance ? <Separator /> : null}
        <ActionButton onClick={actions.edit} label="Edit summary">
          Edit
        </ActionButton>
        {view.canRegenerate ? (
          <>
            <Separator />
            <ActionButton
              onClick={actions.regenerate}
              disabled={actions.busy}
              label="Regenerate summary"
            >
              Regenerate
            </ActionButton>
          </>
        ) : null}
        <Separator />
        <ActionButton onClick={actions.remove} disabled={actions.busy} label="Remove summary">
          Remove
        </ActionButton>
      </div>
      {view.stale && !view.pending ? (
        <p className="text-xs text-amber-700 dark:text-amber-300">
          May be out of date: the instructions changed after this summary was written.
        </p>
      ) : null}
      {view.pending ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
          Writing a new summary…
        </p>
      ) : null}
      {view.failed ? (
        <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
          <span>New {summaryFailureMessage(view.failureCode).replace(/^Summary/, 'summary')}</span>
          <Separator />
          <ActionButton onClick={actions.retry} disabled={actions.busy} label="Retry summary">
            Retry
          </ActionButton>
        </p>
      ) : null}
      {actions.error ? (
        <p role="alert" className="text-xs text-destructive">
          {actions.error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The line under the instruction body when there is no summary: Summarize for eligible
 * long text, "Writing summary…" while one is outstanding, the stable failure with Retry,
 * or the removed state. Short and blank instructions render nothing.
 */
export function ObjectiveSummaryFallback({
  objective,
  view
}: {
  objective: ObjectiveDto;
  view: ObjectiveSummaryView;
}) {
  const actions = useSummaryActions(objective, view);
  const hasInstruction = objective.instructionText.trim().length > 0;
  if (!hasInstruction || view.summary !== null) return null;
  if (!view.pending && !view.failed && !view.canSummarize) return null;

  return (
    <div className="grid gap-0.5 pt-1" data-testid="objective-summary-fallback">
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
        {view.pending ? (
          <>
            <span className="inline-flex items-center gap-1.5" role="status">
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
              Writing summary…
            </span>
            <Separator />
            <ActionButton onClick={actions.remove} disabled={actions.busy} label="Stop summary">
              Cancel
            </ActionButton>
          </>
        ) : view.failed ? (
          <>
            <span>{summaryFailureMessage(view.failureCode)}</span>
            <Separator />
            <ActionButton onClick={actions.retry} disabled={actions.busy} label="Retry summary">
              Retry
            </ActionButton>
          </>
        ) : (
          <>
            {view.suppressed ? (
              <>
                <span>Summary removed</span>
                <Separator />
              </>
            ) : null}
            <ActionButton
              onClick={actions.summarize}
              disabled={actions.busy}
              label="Summarize instructions"
            >
              Summarize
            </ActionButton>
          </>
        )}
      </div>
      {actions.error ? (
        <p role="alert" className="text-xs text-destructive">
          {actions.error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * A person's summary editor. Its text lives in the objective-id buffer store, so a drag,
 * a head change, a refetch that brings a new generated summary, or a launch that remounts
 * the card never discards it. Saving sends the revision the edit started from; a 409
 * keeps the text and shows what changed. Saving empty text is Remove.
 */
export function ObjectiveSummaryEditor({ objective }: { objective: ObjectiveDto }) {
  const buffer = useSummaryBuffer(objective.id);
  const update = useUpdateObjectiveDescription();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Focus on open, but never steal focus from another control (a remount after launch
  // or a refetch must not pull the caret out of whatever the person is doing).
  useEffect(() => {
    const active = document.activeElement;
    if (!active || active === document.body) textareaRef.current?.focus();
  }, []);

  if (!buffer) return null;
  const words = summaryWordCount(buffer.text);
  const tooLong = buffer.text.trim().length > SUMMARY_MAX_CHARACTERS;
  const conflict = buffer.conflictText !== undefined;

  const save = (baseRevision: number) => {
    const text = buffer.text.trim();
    update.mutate(
      {
        id: objective.id,
        description: text.length > 0 ? text : null,
        expectedDescriptionRevision: baseRevision
      },
      {
        onSuccess: () => clearSummaryBuffer(objective.id),
        onError: error => {
          if (error instanceof ApiRequestError && error.code === 'description_conflict') {
            updateSummaryBuffer(objective.id, { conflictText: null });
          }
        }
      }
    );
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') {
      // Cancels the edit only; an enclosing objective dialog stays open (plan §9.1).
      event.preventDefault();
      event.stopPropagation();
      markEscapeConsumed(event);
      clearSummaryBuffer(objective.id);
      return;
    }
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      if (!tooLong) save(buffer.baseRevision);
    }
  };

  return (
    <div className="grid gap-1.5" data-testid="objective-summary-editor">
      <textarea
        ref={textareaRef}
        aria-label="Objective summary"
        className="min-h-24 w-full resize-y rounded-md border border-border bg-background px-2 py-1.5 text-sm leading-relaxed outline-none focus-visible:ring-1 focus-visible:ring-ring/60"
        value={buffer.text}
        onChange={event => updateSummaryBuffer(objective.id, { text: event.target.value })}
        onKeyDown={onKeyDown}
        rows={5}
      />
      <p className="text-[11px] text-muted-foreground">
        {words} {words === 1 ? 'word' : 'words'} · aim for about {SUMMARY_TARGET_WORDS}. One to
        three paragraphs: the goal first, the done-when result last. Saving empty text removes the
        summary.
      </p>
      {conflict ? (
        <div
          role="alert"
          className="grid gap-1 rounded-md border border-amber-500/40 bg-amber-50/60 p-2 text-xs dark:bg-amber-500/10"
        >
          <p>This summary changed while you were editing it. Your text is kept. Current version:</p>
          <p className="whitespace-pre-wrap text-muted-foreground">
            {objective.description?.trim() || 'No summary.'}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-sm font-medium underline-offset-2 hover:underline"
              disabled={update.isPending || tooLong}
              onClick={() => save(objective.descriptionRevision ?? 0)}
            >
              Replace with mine
            </button>
            <button
              type="button"
              className="rounded-sm font-medium underline-offset-2 hover:underline"
              onClick={() => clearSummaryBuffer(objective.id)}
            >
              Discard mine
            </button>
          </div>
        </div>
      ) : null}
      {update.error && !conflict ? (
        <p role="alert" className="text-xs text-destructive">
          {actionErrorMessage(update.error)}
        </p>
      ) : null}
      {tooLong ? (
        <p role="alert" className="text-xs text-destructive">
          A summary can have at most {SUMMARY_MAX_CHARACTERS.toLocaleString('en-US')} characters.
        </p>
      ) : null}
      {!conflict ? (
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="inline-flex h-7 items-center rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            disabled={update.isPending || tooLong}
            onClick={() => save(buffer.baseRevision)}
          >
            {update.isPending ? 'Saving…' : 'Save summary'}
          </button>
          <button
            type="button"
            className="inline-flex h-7 items-center rounded-md px-2.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={() => clearSummaryBuffer(objective.id)}
          >
            Cancel
          </button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The summary body for any surface: the editor while a person edits, otherwise the prose
 * with its controls. Render it only when the objective has a summary or an open edit.
 */
export function ObjectiveSummaryBody({
  objective,
  view,
  provenance,
  editing,
  proseId
}: {
  objective: ObjectiveDto;
  view: ObjectiveSummaryView;
  provenance: string | null;
  editing: boolean;
  proseId?: string;
}) {
  if (editing) return <ObjectiveSummaryEditor objective={objective} />;
  if (view.summary === null) return null;
  return (
    <div className="grid gap-1.5">
      <ObjectiveSummaryProse paragraphs={view.paragraphs} id={proseId} />
      <ObjectiveSummaryControls objective={objective} view={view} provenance={provenance} />
    </div>
  );
}
