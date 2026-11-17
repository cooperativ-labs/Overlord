import type { MissionDetailDto, ObjectiveDto } from '@overlord/contract';
import {
  type FocusEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState
} from 'react';

import { useProjectResources, useUpdateObjective } from '../../lib/queries.ts';
import { useRepositoryMentionOptions } from '../../lib/useRepositoryMentionOptions.ts';
import { cn } from '../../lib/utils.ts';
import { MentionableTextarea } from '../MentionableTextarea.tsx';
import { FileDropZone } from '../ui/file-drop-zone.tsx';

import { AgentLaunchButton } from './AgentLaunchButton.tsx';
import { AgentModelChooserButton } from './AgentModelChooserButton.tsx';
import { resolveLaunchSiblingGuard } from './launch-sibling-guard.ts';
import {
  ObjectiveAttachmentList,
  ObjectiveAttachmentUploadTrigger,
  useObjectiveAttachmentState
} from './ObjectiveAttachments.tsx';
import { ObjectiveMenuButton } from './ObjectiveMenuButton.tsx';
import { ObjectiveQueuePopover } from './ObjectiveQueuePopover.tsx';
import { ObjectiveResourcePicker } from './ObjectiveResourcePicker.tsx';
import { ObjectiveSaveButton } from './ObjectiveSaveButton.tsx';
import { useObjectiveAgentSelection } from './useObjectiveAgentSelection.ts';

/** Matches the owner attribute MentionableTextarea stamps on its portal menus. */
const OVERLAY_OWNER_ATTRIBUTE = 'data-blank-mission-card-owner';

const QUEUE_CONTROL_STATES = new Set<ObjectiveDto['state']>(['draft', 'submitted', 'launching']);

type ComposerSavedObjectiveProps = {
  objective: ObjectiveDto;
  mission: MissionDetailDto;
  /** Called after the objective was deleted from its menu. */
  onDeleted?: () => void;
};

/**
 * The composer after its objective is saved (coo:1289). The objective stays in the composer
 * with the full saved-objective toolbar — id, actions menu, Run Queue, resource, agent/model and
 * the split Run button — instead of jumping into the objective list. The mission panel hands it
 * to the list when the person leaves the panel or clicks "+ Add objective".
 *
 * The toolbar's primary slot follows the mobile composer's ladder: edited (unsaved) text shows
 * Save, saved text shows the green Run. Edits save like the unsaved composer's: Save, Cmd/Ctrl+
 * Enter, leaving the card (pointerdown or focus outside it and its mention menus), unmount, or
 * Run itself (its `beforeLaunch` flushes the edit first). Escape reverts to the saved text. An
 * emptied instruction is never saved; Save stays disabled until there is text again.
 */
export function ComposerSavedObjective({
  objective,
  mission,
  onDeleted
}: ComposerSavedObjectiveProps) {
  const update = useUpdateObjective();
  const overlayOwnerId = useId();
  const { mentionPaths, projectMentionOptions, missionMentionOptions } =
    useRepositoryMentionOptions(objective.projectId, objective.resourceKey);
  const resourcesQ = useProjectResources(objective.projectId);
  const {
    catalog,
    agentConfigs,
    selection,
    setSelection,
    commitLaunchConfig,
    useInheritedLaunchConfig,
    launchConfigSourceHint,
    loaded
  } = useObjectiveAgentSelection(objective);
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

  const [text, setText] = useState(objective.instructionText);
  /** The text last known to be saved: the server's, or ours once a save resolves. */
  const [baseline, setBaseline] = useState(objective.instructionText);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // A server-side change (another tab, an agent) is adopted only while there is no local edit.
  const serverText = objective.instructionText;
  const lastServerTextRef = useRef(serverText);
  useEffect(() => {
    if (serverText === lastServerTextRef.current) return;
    lastServerTextRef.current = serverText;
    setText(current => (current.trim() === baseline.trim() ? serverText : current));
    setBaseline(serverText);
  }, [serverText, baseline]);

  const trimmed = text.trim();
  const dirty = trimmed !== baseline.trim();
  const canSave = dirty && trimmed.length > 0;

  // Handlers outside React's render cycle (document pointerdown, unmount) read through refs.
  const stateRef = useRef({ text, baseline, objectiveId: objective.id });
  stateRef.current = { text, baseline, objectiveId: objective.id };
  const savePromiseRef = useRef<Promise<boolean> | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const mutateRef = useRef(update.mutateAsync);
  mutateRef.current = update.mutateAsync;

  /** Save the edit if there is one. Resolves true when the objective holds the shown text. */
  const save = useCallback((): Promise<boolean> => {
    if (savePromiseRef.current) return savePromiseRef.current;
    const { text: current, baseline: saved, objectiveId } = stateRef.current;
    const next = current.trim();
    if (next === saved.trim()) return Promise.resolve(true);
    if (next.length === 0) return Promise.resolve(false);
    setSaving(true);
    setSaveError(null);
    const promise = mutateRef
      .current({ id: objectiveId, body: { instructionText: next } })
      .then(() => {
        setBaseline(next);
        return true;
      })
      .catch((err: unknown) => {
        setSaveError(err instanceof Error ? err.message : 'Failed to save the objective.');
        return false;
      })
      .finally(() => {
        savePromiseRef.current = null;
        setSaving(false);
      });
    savePromiseRef.current = promise;
    return promise;
  }, []);
  const saveRef = useRef(save);
  saveRef.current = save;

  const isInsideCard = useCallback(
    (target: EventTarget | null) => {
      if (!(target instanceof Node)) return false;
      if (rootRef.current?.contains(target)) return true;
      const element = target instanceof Element ? target : target.parentElement;
      return Boolean(element?.closest(`[${OVERLAY_OWNER_ATTRIBUTE}="${overlayOwnerId}"]`));
    },
    [overlayOwnerId]
  );

  // Leaving by pointer saves the edit.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (isInsideCard(event.target)) return;
      void saveRef.current();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [isInsideCard]);

  // Leaving the panel (or "+ Add objective") must not lose an unsaved edit.
  useEffect(() => {
    return () => {
      void saveRef.current();
    };
  }, []);

  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget;
    if (next === null || isInsideCard(next)) return;
    void save();
  };

  const handleTextKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setText(baseline);
      setSaveError(null);
      return;
    }
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void save();
    }
  };

  const primaryResourceKey =
    resourcesQ.data?.find(resource => resource.isPrimary)?.resourceKey ?? 'primary';
  const guard = resolveLaunchSiblingGuard({
    objective,
    siblings: mission.objectives,
    executionRequests: mission.executionRequests,
    allowParallelObjectives: mission.allowParallelObjectives,
    primaryResourceKey
  });
  const showRun = !dirty && !saving;

  return (
    <div ref={rootRef} data-testid="composer-saved-objective" onBlur={handleBlur}>
      <FileDropZone
        onDrop={handleFiles}
        disabled={isUploading}
        dragState={dragState}
        className={cn(
          'w-full overflow-hidden rounded-xl border border-(--color-border) bg-(--color-surface-1)',
          'shadow-[0_4px_16px_-6px_rgba(0,0,0,0.18)] transition-all dark:shadow-[0_4px_16px_-6px_rgba(0,0,0,0.6)]',
          'focus-within:shadow-md focus-within:ring-1 focus-within:ring-ring/50 md:min-w-[350px]',
          objective.state === 'launching' &&
            'border-sky-400/45 bg-sky-500/5 focus-within:ring-sky-400/30'
        )}
      >
        <div className="px-3 pb-2 pt-3">
          <MentionableTextarea
            value={text}
            onValueChange={setText}
            mentionPaths={mentionPaths}
            projectMentionOptions={projectMentionOptions}
            missionMentionOptions={missionMentionOptions}
            menuOwnerId={overlayOwnerId}
            autoListContinuation="enter"
            maxHeightPx={360}
            rows={2}
            aria-label="Objective instruction"
            placeholder="Describe what the agent should do… (@ file, # project, $ mission)"
            className="min-h-[3.25em] border-none bg-transparent text-base font-medium text-foreground/90"
            onKeyDown={handleTextKeyDown}
          />
        </div>

        <div className="border-t border-border/40">
          <ObjectiveAttachmentList
            attachments={attachments}
            removingId={removingId}
            onRemove={handleRemove}
            toolbar
          />
          {saveError || attachmentError ? (
            <p className="px-3 pb-1 pt-1.5 text-xs text-destructive" role="alert">
              {saveError ?? attachmentError}
            </p>
          ) : null}
          <ObjectiveAttachmentUploadTrigger
            attachmentsCount={attachments.length}
            inputRef={inputRef}
            onInputChange={handleInputChange}
            disabled={isUploading}
          >
            {objective.displayId ? (
              <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                {objective.displayId}
              </span>
            ) : null}
            <ObjectiveMenuButton
              objectiveId={objective.id}
              displayId={objective.displayId}
              state={objective.state}
              onDeleted={onDeleted}
            />
            {QUEUE_CONTROL_STATES.has(objective.state) || objective.queueEntry ? (
              <ObjectiveQueuePopover objective={objective} triggerClassName="h-7" />
            ) : null}

            <ObjectiveResourcePicker
              resources={resourcesQ.data ?? []}
              value={objective.resourceKey}
              disabled={update.isPending}
              onChange={resourceKey => update.mutate({ id: objective.id, body: { resourceKey } })}
            />

            <AgentModelChooserButton
              catalog={catalog}
              selection={selection}
              onChange={setSelection}
              agentConfigs={agentConfigs}
              onLaunchConfigCommit={commitLaunchConfig}
              onUseInheritedDefault={useInheritedLaunchConfig}
              launchConfigSourceHint={launchConfigSourceHint}
            />

            {showRun ? (
              <AgentLaunchButton
                objective={objective}
                selection={selection}
                selectionLoaded={loaded}
                hasActiveSibling={guard.hasBlockingSibling}
                activeSiblingId={guard.activeSiblingId}
                activeRequest={guard.activeRequest}
                beforeLaunch={save}
                size="sm"
              />
            ) : (
              <ObjectiveSaveButton
                onSave={() => void save()}
                saving={saving}
                disabled={!canSave}
                title={
                  canSave
                    ? 'Save your changes. They also save when you leave the card.'
                    : 'Write an instruction to save this objective.'
                }
              />
            )}
          </ObjectiveAttachmentUploadTrigger>
        </div>
      </FileDropZone>
    </div>
  );
}
