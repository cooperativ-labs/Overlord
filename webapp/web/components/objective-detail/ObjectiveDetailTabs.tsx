import {
  objectiveHasInstructionText,
  shouldDiscardEmptiedObjective
} from '@overlord/automations/objective-manager';
import type { ObjectiveDto } from '@overlord/contract';
import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';

import { discardObjectiveEdit, useObjectiveEditBuffer } from '../../lib/objective-edit-buffers.ts';
import { useDeleteObjective, useUpdateObjective } from '../../lib/queries.ts';
import { useRepositoryMentionOptions } from '../../lib/useRepositoryMentionOptions.ts';
import { cn } from '../../lib/utils.ts';
import { InlineEditField } from '../InlineEditField.tsx';
import { isNotStartedObjective } from '../objectives/ObjectiveRow.tsx';
import {
  ObjectiveSummaryBody,
  ObjectiveSummaryFallback,
  SummaryMentionBadges,
  useObjectiveSummary
} from '../objectives/ObjectiveSummary.tsx';

type DetailTab = 'summary' | 'instructions';
const TABS: { id: DetailTab; label: string }[] = [
  { id: 'summary', label: 'Summary' },
  { id: 'instructions', label: 'Instructions' }
];

/** What deletion of an emptied draft depends on; `null` while it is still loading. */
export type EmptyDraftGuard = { attachmentCount: number; hasHistory: boolean } | null;

/**
 * Summary and Instructions (mission-panel-redesign plan §9.6). Mount it keyed by objective id:
 * Summary is selected whenever a detail opens or the objective changes.
 *
 * Both tab panels stay mounted (the inactive one is `hidden`), so switching tabs never unmounts
 * the instruction editor: the click that switches tabs blurs and commits it, and its text lives
 * in the objective-keyed buffer regardless. A summary that arrives while the instructions are
 * being edited selects the Instructions tab, so the editor is never obscured.
 */
export function ObjectiveDetailTabs({
  objective,
  emptyDraftGuard,
  onObjectiveDeleted
}: {
  objective: ObjectiveDto;
  emptyDraftGuard: EmptyDraftGuard;
  /** The emptied draft was deleted; the detail closes only after deletion succeeded. */
  onObjectiveDeleted: () => void;
}) {
  const summary = useObjectiveSummary(objective);
  const notStarted = isNotStartedObjective(objective.state);
  const instructionBuffer = useObjectiveEditBuffer(objective.id, 'instruction');
  // An old summary never stands in for an empty instruction: a blank draft keeps its editor.
  const hasSummaryLayout =
    ((!notStarted || objectiveHasInstructionText(objective)) && summary.view.summary !== null) ||
    summary.editing;
  const [selected, setSelected] = useState<DetailTab>(() =>
    instructionBuffer ? 'instructions' : 'summary'
  );
  const editingInstructions = instructionBuffer !== undefined;
  const previousLayout = useRef(hasSummaryLayout);
  useEffect(() => {
    if (hasSummaryLayout && !previousLayout.current && editingInstructions) {
      setSelected('instructions');
    }
    previousLayout.current = hasSummaryLayout;
  }, [editingInstructions, hasSummaryLayout]);

  const baseId = useId();
  const tabRefs = useRef<Record<DetailTab, HTMLButtonElement | null>>({
    summary: null,
    instructions: null
  });

  const instructions = (
    <ObjectiveInstructions
      objective={objective}
      emptyDraftGuard={emptyDraftGuard}
      onObjectiveDeleted={onObjectiveDeleted}
    />
  );

  if (!hasSummaryLayout) {
    return (
      <div className="grid min-w-0 gap-2">
        {instructions}
        <ObjectiveSummaryFallback objective={objective} view={summary.view} />
      </div>
    );
  }

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = TABS.findIndex(tab => tab.id === selected);
    let next: number | null = null;
    if (event.key === 'ArrowRight') next = (index + 1) % TABS.length;
    if (event.key === 'ArrowLeft') next = (index - 1 + TABS.length) % TABS.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = TABS.length - 1;
    if (next === null) return;
    event.preventDefault();
    const tab = TABS[next]!;
    setSelected(tab.id);
    tabRefs.current[tab.id]?.focus();
  };

  return (
    <div className="grid min-w-0 gap-2">
      <div role="tablist" aria-label="Objective text" className="flex items-center gap-4">
        {TABS.map(tab => {
          const isSelected = tab.id === selected;
          return (
            <button
              key={tab.id}
              ref={node => {
                tabRefs.current[tab.id] = node;
              }}
              type="button"
              role="tab"
              id={`${baseId}-tab-${tab.id}`}
              aria-selected={isSelected}
              aria-controls={`${baseId}-panel-${tab.id}`}
              tabIndex={isSelected ? 0 : -1}
              onClick={() => setSelected(tab.id)}
              onKeyDown={onKeyDown}
              className={cn(
                'border-b pb-0.5 text-[11px] font-semibold uppercase tracking-[0.14em] outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                isSelected
                  ? 'border-(--color-ink) text-(--color-ink)'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      <div
        role="tabpanel"
        id={`${baseId}-panel-summary`}
        aria-labelledby={`${baseId}-tab-summary`}
        hidden={selected !== 'summary'}
        className="grid min-w-0 gap-2 text-sm leading-relaxed"
      >
        {/* The decision and caution mentions the compact rows no longer carry (plan §7.5). */}
        {summary.editing ? null : <SummaryMentionBadges mentions={summary.view.mentions} />}
        <ObjectiveSummaryBody
          objective={objective}
          view={summary.view}
          provenance={summary.provenance}
          editing={summary.editing}
        />
      </div>
      <div
        role="tabpanel"
        id={`${baseId}-panel-instructions`}
        aria-labelledby={`${baseId}-tab-instructions`}
        hidden={selected !== 'instructions'}
        className="min-w-0"
      >
        {instructions}
      </div>
    </div>
  );
}

/**
 * The instructions: an editor while not started (multiline, `@`/`#`/`$` mentions), read-only
 * text otherwise. Emptying a draft deletes it only when `shouldDiscardEmptiedObjective` allows
 * it for its attachments and history; until those are known the empty save is refused with a
 * retry rather than guessed. A state change that ends "not started" mid-edit keeps the unsaved
 * text visible with an explicit Discard instead of saving it against the running objective.
 */
function ObjectiveInstructions({
  objective,
  emptyDraftGuard,
  onObjectiveDeleted
}: {
  objective: ObjectiveDto;
  emptyDraftGuard: EmptyDraftGuard;
  onObjectiveDeleted: () => void;
}) {
  const update = useUpdateObjective();
  const remove = useDeleteObjective();
  const notStarted = isNotStartedObjective(objective.state);
  const buffer = useObjectiveEditBuffer(objective.id, 'instruction');
  const { mentionPaths, projectMentionOptions, missionMentionOptions } =
    useRepositoryMentionOptions(objective.projectId, objective.resourceKey);

  if (!notStarted) {
    return (
      <div className="grid min-w-0 gap-2">
        {buffer ? (
          <div
            role="alert"
            className="grid gap-1 rounded-md border border-amber-500/40 bg-amber-50/60 p-2 text-xs dark:bg-amber-500/10"
          >
            <p>
              This objective started while you were editing its instructions. Your unsaved text was
              not applied:
            </p>
            <p className="whitespace-pre-wrap wrap-anywhere text-muted-foreground">{buffer.text}</p>
            <button
              type="button"
              className="justify-self-start rounded-sm font-medium underline-offset-2 hover:underline"
              onClick={() => discardObjectiveEdit(objective.id, 'instruction')}
            >
              Discard
            </button>
          </div>
        ) : null}
        <InlineEditField
          multiline
          disabled
          value={objective.instructionText}
          className="block whitespace-pre-wrap wrap-anywhere text-sm leading-relaxed text-foreground/90"
          ariaLabel="Objective instruction"
          onSave={() => undefined}
        />
      </div>
    );
  }

  const save = async (instructionText: string) => {
    if (instructionText.trim().length === 0) {
      if (!emptyDraftGuard) {
        throw new Error('Still checking attachments and history. Try again in a moment.');
      }
      if (shouldDiscardEmptiedObjective({ ...objective, instructionText }, emptyDraftGuard)) {
        await remove.mutateAsync(objective.id);
        onObjectiveDeleted();
        return;
      }
    }
    await update.mutateAsync({ id: objective.id, body: { instructionText } });
  };

  return (
    <div className="min-w-0 text-sm leading-relaxed">
      <InlineEditField
        multiline
        buffer={{ objectiveId: objective.id, field: 'instruction' }}
        value={objective.instructionText}
        className="text-base font-medium whitespace-pre-wrap wrap-anywhere text-foreground/90"
        inputClassName="text-base font-medium whitespace-pre-wrap text-foreground/90"
        minRows={objective.state === 'draft' ? 2 : 1}
        placeholder="Describe what the agent should do… (@ file, # project, $ mission)"
        ariaLabel="Objective instruction"
        editButtonLabel="Edit instructions"
        commitEmpty={objective.state === 'draft'}
        mentionPaths={mentionPaths}
        projectMentionOptions={projectMentionOptions}
        missionMentionOptions={missionMentionOptions}
        onSave={save}
      />
    </div>
  );
}
