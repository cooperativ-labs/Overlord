import type { AgentLaunchConfigDto, CreateObjectiveBody, ObjectiveDto } from '@overlord/contract';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, Play } from 'lucide-react';
import {
  type FocusEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState
} from 'react';

import { api } from '../../lib/api.ts';
import { keys, useProjectResources, useUpdateLaunchPreference } from '../../lib/queries.ts';
import { refetchNonEverhourQueries } from '../../lib/query-invalidation.ts';
import { useRepositoryMentionOptions } from '../../lib/useRepositoryMentionOptions.ts';
import { cn } from '../../lib/utils.ts';
import { MentionableTextarea } from '../MentionableTextarea.tsx';
import { Button } from '../ui/button.tsx';
import { FileDropZone } from '../ui/file-drop-zone.tsx';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip.tsx';

import { AgentModelChooserButton } from './AgentModelChooserButton.tsx';
import { type AgentModelSelection } from './AgentModelSelector.tsx';
import { AttachmentThumbnails } from './AttachmentThumbnails.tsx';
import {
  MAX_ATTACHMENT_BYTES,
  ObjectiveAttachmentUploadTrigger,
  usePendingAttachments
} from './ObjectiveAttachments.tsx';
import { ObjectiveResourcePicker } from './ObjectiveResourcePicker.tsx';
import { useObjectiveAgentSelection } from './useObjectiveAgentSelection.ts';

type GhostObjectiveProps = {
  missionId: string;
  projectId: string;
  /** Called once the composer has persisted a real objective and the list shows it. */
  onMaterialized?: () => void;
  /** Called when the user leaves (or Escapes) an empty composer and it should disappear. */
  onDismissEmpty?: () => void;
  /**
   * Reports the id of the objective this composer is committing, then `null`
   * once the list may show it. The mission panel hides that id meanwhile, so a
   * realtime refetch that lands mid-commit never shows the objective twice.
   */
  onCommittingChange?: (objectiveId: string | null) => void;
  /** Take focus on mount — used for the slot the user just asked for. */
  autoFocus?: boolean;
};

/** `editing`: the buffer is live. `saving`: the commit pipeline runs. `upload_failed`: the
 * objective exists but some staged files did not upload; only those are retried. */
type Phase = 'editing' | 'saving' | 'upload_failed';

type LaunchConfigBuffer = { agent: string; config: AgentLaunchConfigDto };

/** Which of the card's portal popups is open. Clicks and focus inside them are not exits. */
type PopupName = 'resource' | 'agent' | 'mention';

/** Matches the owner attribute MentionableTextarea stamps on its portal menus. */
const OVERLAY_OWNER_ATTRIBUTE = 'data-blank-mission-card-owner';

/** Longest the commit waits for the post-create refetch before handing over. */
const REFETCH_WAIT_CAP_MS = 8000;

/**
 * The unsaved objective composer — a "ghost" card that looks like a draft
 * objective but exists only in the client until the user leaves it.
 *
 * Overlord used to keep an empty objective row in the database purely so the
 * mission panel had a field to type into, and later saved the row the moment
 * the text field blurred or any setting changed. Both disturbed the user: the
 * real row replaced this card mid-edit (remount, lost focus, a compact card
 * when other objectives were queued), and half-configured work became visible
 * to agents and the Run Queue.
 *
 * The card is now a client-side draft. Instruction text, resource, agent/model,
 * the launch-config override and staged attachment files are buffered locally;
 * nothing is written while the user works inside the card. It commits when the
 * user **leaves the card**: a pointerdown outside it, focus moving to a real
 * element outside it (Tab), Cmd/Ctrl+Enter, or unmount (panel close, route
 * change). Clicks and focus inside the card's own popups (resource picker,
 * agent/model chooser, mention menus — all portals) are not exits, nor is a
 * focus loss with no destination (the native file dialog, a window switch).
 *
 * The commit is one pipeline: a single create carrying text, `resourceKey` and
 * the agent/model/launch-config selection (the server validates and writes it
 * atomically), then the staged uploads to the new id, then one refetch, and
 * only then {@link GhostObjectiveProps.onMaterialized} — so the card is swapped
 * for the real {@link DraftObjective} exactly once. Meanwhile the card stays in
 * place, read-only, showing "Saving…". A failed create returns the card to
 * editing with everything intact; a failed upload keeps the card with the error
 * and retries only the failed files against the objective that already exists.
 *
 * Leaving with no text and no files writes nothing (settings alone are not
 * work); Escape discards the whole buffer. Run stays disabled: it needs a real
 * objective id. Creating with `state: 'draft'` lets the server append behind an
 * existing draft, so the queue keeps exactly one next-up objective.
 */
export function GhostObjective({
  missionId,
  projectId,
  onMaterialized,
  onDismissEmpty,
  onCommittingChange,
  autoFocus = false
}: GhostObjectiveProps) {
  const qc = useQueryClient();
  const overlayOwnerId = useId();
  const { mentionPaths, projectMentionOptions, missionMentionOptions } =
    useRepositoryMentionOptions(projectId);
  const resourcesQ = useProjectResources(projectId);
  const updatePreference = useUpdateLaunchPreference(projectId);
  // No objective exists yet, so the default selection resolves as a fresh
  // objective's would: project preference, then catalog default.
  const {
    catalog,
    agentConfigs: inheritedAgentConfigs,
    selection: defaultSelection,
    loaded: selectionLoaded
  } = useObjectiveAgentSelection({
    id: '',
    projectId,
    assignedAgent: null,
    model: null,
    reasoningEffort: null
  });

  const [text, setText] = useState('');
  const [resourceKey, setResourceKey] = useState<string | null>(null);
  const [localSelection, setLocalSelection] = useState<AgentModelSelection | null>(null);
  const [launchConfig, setLaunchConfig] = useState<LaunchConfigBuffer | null>(null);
  const pending = usePendingAttachments();
  const { clear: clearFiles, addFiles } = pending;
  const [phase, setPhaseState] = useState<Phase>('editing');
  const [commitError, setCommitError] = useState<string | null>(null);

  const effectiveSelection = localSelection ?? defaultSelection;
  const agentConfigs = launchConfig
    ? { ...inheritedAgentConfigs, [launchConfig.agent]: launchConfig.config }
    : inheritedAgentConfigs;

  // Event handlers outside React's render cycle (document pointerdown, unmount)
  // read the buffer through refs so they always see the latest values.
  const bufferRef = useRef({ text, resourceKey, localSelection, launchConfig });
  bufferRef.current = { ...bufferRef.current, resourceKey, localSelection, launchConfig };
  const filesRef = useRef<File[]>(pending.files);
  filesRef.current = pending.files;
  const phaseRef = useRef<Phase>('editing');
  const setPhase = (next: Phase) => {
    phaseRef.current = next;
    setPhaseState(next);
  };
  const callbacksRef = useRef({ onMaterialized, onDismissEmpty, onCommittingChange });
  callbacksRef.current = { onMaterialized, onDismissEmpty, onCommittingChange };

  const rootRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  /** The user has interacted with the card since it was last committed or dismissed. */
  const engagedRef = useRef(false);
  const openPopupsRef = useRef<Set<PopupName>>(new Set());
  const commitPromiseRef = useRef<Promise<void> | null>(null);
  /** The objective already created by a commit whose uploads are not finished. */
  const createdRef = useRef<ObjectiveDto | null>(null);

  useEffect(() => {
    if (autoFocus) textareaRef.current?.focus();
  }, [autoFocus]);

  const setPopupOpen = useCallback((name: PopupName, open: boolean) => {
    if (open) {
      openPopupsRef.current.add(name);
      return;
    }
    // Defer the close: the outside pointerdown that dismisses a popup must
    // still see it open, so that one click closes the popup and does not also
    // commit the card. Focus returning to the trigger lands in the card anyway.
    setTimeout(() => openPopupsRef.current.delete(name), 0);
  }, []);

  const resetBuffer = useCallback(() => {
    bufferRef.current = { text: '', resourceKey: null, localSelection: null, launchConfig: null };
    // Synchronously, not on the next render: the swap that follows a commit
    // unmounts this card, and the unmount commit must see an empty buffer.
    filesRef.current = [];
    setText('');
    setResourceKey(null);
    setLocalSelection(null);
    setLaunchConfig(null);
    clearFiles();
    setCommitError(null);
    engagedRef.current = false;
    createdRef.current = null;
  }, [clearFiles]);

  /** Upload `files` to the created objective; returns the files that failed and the first error. */
  const uploadStaged = useCallback(async (objectiveId: string, files: File[]) => {
    const failed: File[] = [];
    let firstError: string | null = null;
    for (const file of files) {
      if (file.size > MAX_ATTACHMENT_BYTES) continue;
      try {
        await api.uploadObjectiveAttachment(objectiveId, file);
      } catch (err) {
        failed.push(file);
        firstError ??= err instanceof Error ? err.message : `Failed to upload "${file.name}".`;
      }
    }
    return { failed, firstError };
  }, []);

  /** Refetch once, then hand the card over to the real objective row. */
  const finish = useCallback(
    async (objectiveId: string) => {
      void qc.invalidateQueries({ queryKey: keys.objectiveAttachments(objectiveId) });
      // Swap once the list holds the new row. A refetch that hangs must not
      // strand the card in "Saving…": after the cap the row arrives whenever
      // the refetch (or realtime) lands.
      let capTimer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        refetchNonEverhourQueries(qc),
        new Promise(resolve => {
          capTimer = setTimeout(resolve, REFETCH_WAIT_CAP_MS);
        })
      ]);
      clearTimeout(capTimer);
      resetBuffer();
      setPhase('editing');
      callbacksRef.current.onCommittingChange?.(null);
      callbacksRef.current.onMaterialized?.();
    },
    [qc, resetBuffer]
  );

  const uploadThenFinish = useCallback(
    async (created: ObjectiveDto, files: File[]) => {
      const { failed, firstError } = await uploadStaged(created.id, files);
      if (failed.length > 0) {
        clearFiles();
        addFiles(failed);
        setCommitError(
          `The objective was saved, but ${failed.length === 1 ? 'an attachment' : `${failed.length} attachments`} did not upload: ${firstError ?? 'unknown error'}`
        );
        setPhase('upload_failed');
        return;
      }
      await finish(created.id);
    },
    [addFiles, clearFiles, finish, uploadStaged]
  );

  const runCommit = useCallback(async () => {
    const {
      text: rawText,
      resourceKey: key,
      localSelection: chosen,
      launchConfig: override
    } = bufferRef.current;
    const instructionText = rawText.trim();
    const files = filesRef.current;
    setCommitError(null);
    setPhase('saving');

    const body: CreateObjectiveBody = { missionId, instructionText, state: 'draft' };
    if (key !== null) body.resourceKey = key;
    // Only a selection the user changed is sent; otherwise the server applies
    // the same default this card displayed (the project's launch preference).
    if (chosen) {
      body.assignedAgent = chosen.agent;
      body.model = chosen.model;
      body.reasoningEffort = chosen.reasoningEffort;
    }
    if (override) {
      body.launchConfigAgent = override.agent;
      body.launchConfigOverride = override.config;
    }

    let created: ObjectiveDto;
    try {
      created = await api.createObjective(body);
    } catch (err) {
      setCommitError(err instanceof Error ? err.message : 'Failed to save the objective.');
      setPhase('editing');
      return;
    }
    createdRef.current = created;
    callbacksRef.current.onCommittingChange?.(created.id);
    if (chosen) {
      // Same side effect setSelection has on a saved objective: the next
      // objective in this project starts from this choice.
      updatePreference
        .mutateAsync({
          selectedAgent: chosen.agent,
          selectedModel: chosen.model,
          selectedReasoningEffort: chosen.reasoningEffort
        })
        .catch(() => undefined);
    }
    await uploadThenFinish(created, files);
  }, [missionId, updatePreference, uploadThenFinish]);

  /**
   * Leave the card. Concurrent exit triggers share one in-flight commit. An
   * empty buffer writes nothing; on unmount it is not dismissed either, since
   * the card is going away regardless.
   */
  const commit = useCallback(
    ({ unmounting = false }: { unmounting?: boolean } = {}): Promise<void> => {
      if (commitPromiseRef.current) return commitPromiseRef.current;
      if (phaseRef.current !== 'editing') return Promise.resolve();
      const hasWork = bufferRef.current.text.trim().length > 0 || filesRef.current.length > 0;
      if (!hasWork) {
        engagedRef.current = false;
        if (!unmounting) callbacksRef.current.onDismissEmpty?.();
        return Promise.resolve();
      }
      const promise = runCommit().finally(() => {
        commitPromiseRef.current = null;
      });
      commitPromiseRef.current = promise;
      return promise;
    },
    [runCommit]
  );
  const commitRef = useRef(commit);
  commitRef.current = commit;

  const isInsideCard = useCallback(
    (target: EventTarget | null) => {
      if (!(target instanceof Node)) return false;
      if (rootRef.current?.contains(target)) return true;
      const element = target instanceof Element ? target : target.parentElement;
      return Boolean(element?.closest(`[${OVERLAY_OWNER_ATTRIBUTE}="${overlayOwnerId}"]`));
    },
    [overlayOwnerId]
  );

  // Leaving by pointer: any pointerdown outside the card and its popups.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!engagedRef.current || phaseRef.current !== 'editing') return;
      if (openPopupsRef.current.size > 0) return;
      if (isInsideCard(event.target)) return;
      void commitRef.current();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [isInsideCard]);

  // Losing the card without leaving it (panel close, route change) must not
  // lose what the user wrote. Runs on unmount only.
  useEffect(() => {
    return () => {
      void commitRef.current({ unmounting: true });
    };
  }, []);

  // Leaving by keyboard: focus moved to a real element outside the card. No
  // `relatedTarget` means the window lost focus (native file dialog, app
  // switch) — not an exit.
  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget;
    if (next === null || phaseRef.current !== 'editing') return;
    if (openPopupsRef.current.size > 0 || isInsideCard(next)) return;
    void commit();
  };

  const handleTextKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      resetBuffer();
      callbacksRef.current.onDismissEmpty?.();
      return;
    }
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void commit();
    }
  };

  const retryUploads = async () => {
    const created = createdRef.current;
    if (!created) return;
    setCommitError(null);
    setPhase('saving');
    await uploadThenFinish(created, filesRef.current);
  };

  const continueWithoutFailedUploads = async () => {
    const created = createdRef.current;
    if (!created) return;
    setPhase('saving');
    await finish(created.id);
  };

  const readOnly = phase !== 'editing';
  const errorMessage = commitError ?? pending.error;

  return (
    <div
      ref={rootRef}
      data-testid="ghost-objective"
      aria-busy={phase === 'saving'}
      onPointerDownCapture={() => {
        engagedRef.current = true;
      }}
      onFocusCapture={() => {
        engagedRef.current = true;
      }}
      onBlur={handleBlur}
    >
      <FileDropZone
        onDrop={addFiles}
        disabled={readOnly}
        className={cn(
          'w-full overflow-hidden rounded-xl border border-dashed border-muted-foreground/25',
          'transition-all focus-within:border-solid focus-within:border-muted-foreground/20',
          'focus-within:shadow-md focus-within:ring-1 focus-within:ring-ring/50 md:min-w-[350px]',
          phase === 'saving' && 'opacity-80'
        )}
      >
        <div className="px-3 pb-2 pt-3">
          <MentionableTextarea
            ref={textareaRef}
            value={text}
            onValueChange={next => {
              bufferRef.current = { ...bufferRef.current, text: next };
              setText(next);
            }}
            mentionPaths={mentionPaths}
            projectMentionOptions={projectMentionOptions}
            missionMentionOptions={missionMentionOptions}
            menuOwnerId={overlayOwnerId}
            onMentionMenuOpenChange={open => setPopupOpen('mention', open)}
            autoListContinuation="enter"
            maxHeightPx={360}
            rows={2}
            readOnly={readOnly}
            aria-label="New objective instruction"
            placeholder="Describe what the agent should do… (@ file, # project, $ mission)"
            className="min-h-[3.25em] border-none bg-transparent text-base font-medium text-foreground/90"
            onKeyDown={handleTextKeyDown}
          />
        </div>

        <AttachmentThumbnails
          files={pending.files}
          onRemoveFile={readOnly ? undefined : pending.removeAt}
          disabled={readOnly}
        />

        <div className="border-t border-border/40">
          {phase === 'saving' ? (
            <p
              className="flex items-center gap-1.5 px-3 pb-1 pt-1.5 text-xs text-muted-foreground"
              role="status"
            >
              <Loader2 className="h-3 w-3 animate-spin" />
              Saving…
            </p>
          ) : errorMessage ? (
            <p className="px-3 pb-1 pt-1.5 text-xs text-destructive" role="alert">
              {errorMessage}
            </p>
          ) : null}
          {phase === 'upload_failed' ? (
            <div className="flex flex-wrap items-center gap-2 px-3 pb-1 pt-1">
              <Button type="button" size="sm" variant="secondary" onClick={retryUploads}>
                Retry upload
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={continueWithoutFailedUploads}
              >
                Continue without {pending.files.length === 1 ? 'it' : 'them'}
              </Button>
            </div>
          ) : null}
          <ObjectiveAttachmentUploadTrigger
            attachmentsCount={pending.files.length}
            inputRef={pending.inputRef}
            onInputChange={pending.handleInputChange}
            disabled={readOnly}
          >
            <ObjectiveResourcePicker
              resources={resourcesQ.data ?? []}
              value={resourceKey}
              disabled={readOnly}
              onChange={setResourceKey}
              onOpenChange={open => setPopupOpen('resource', open)}
            />

            <AgentModelChooserButton
              catalog={catalog}
              selection={effectiveSelection}
              onChange={setLocalSelection}
              agentConfigs={agentConfigs}
              onLaunchConfigCommit={(agent, config) => setLaunchConfig({ agent, config })}
              disabled={readOnly}
              onOpenChange={open => setPopupOpen('agent', open)}
            />

            <Tooltip>
              <TooltipTrigger
                render={
                  <span className="inline-flex shrink-0 cursor-not-allowed">
                    <span
                      className={cn(
                        'inline-flex h-8 items-center gap-1.5 rounded-md border border-input',
                        'bg-background px-3 text-xs font-medium text-foreground opacity-60 shadow-sm'
                      )}
                    >
                      <Play className="h-3.5 w-3.5" />
                      Run
                    </span>
                  </span>
                }
              />
              <TooltipContent side="top">
                {selectionLoaded
                  ? 'This objective saves when you leave the card. Run is available once it is saved.'
                  : 'Loading your agent model selection.'}
              </TooltipContent>
            </Tooltip>
          </ObjectiveAttachmentUploadTrigger>
        </div>
      </FileDropZone>
    </div>
  );
}
