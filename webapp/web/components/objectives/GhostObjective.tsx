import { useQueryClient } from '@tanstack/react-query';
import { Play } from 'lucide-react';
import { type ChangeEvent, useCallback, useEffect, useRef, useState } from 'react';

import type { AgentLaunchConfigDto, ObjectiveDto } from '../../../shared/contract.ts';
import { api } from '../../lib/api.ts';
import { keys, useCreateObjective, useProjectResources } from '../../lib/queries.ts';
import { useRepositoryMentionOptions } from '../../lib/useRepositoryMentionOptions.ts';
import { cn } from '../../lib/utils.ts';
import { MentionableTextarea } from '../MentionableTextarea.tsx';
import { FileDropZone } from '../ui/file-drop-zone.tsx';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip.tsx';

import { AgentModelChooserButton } from './AgentModelChooserButton.tsx';
import { type AgentModelSelection } from './AgentModelSelector.tsx';
import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_LABEL,
  ObjectiveAttachmentUploadTrigger
} from './ObjectiveAttachments.tsx';
import { ObjectiveResourcePicker } from './ObjectiveResourcePicker.tsx';
import { useObjectiveAgentSelection } from './useObjectiveAgentSelection.ts';

type GhostObjectiveProps = {
  missionId: string;
  projectId: string;
  /** Called once the composer has persisted a real objective. */
  onMaterialized?: () => void;
  /** Called when an empty composer is dismissed (blurred) and should disappear. */
  onDismissEmpty?: () => void;
  /** Take focus on mount — used for the slot the user just asked for. */
  autoFocus?: boolean;
};

/**
 * The unsaved objective composer — a "ghost" card that looks like a draft
 * objective but exists only in the client.
 *
 * Overlord used to keep an empty objective row in the database purely so the
 * mission panel had a field to type into. That row was indistinguishable from
 * real work everywhere else: agents received it as a queued objective, counts
 * and auto-advance had to special-case blank instruction text, and abandoned
 * slots accumulated. The slot is now client-only and persists an objective the
 * moment the user shows real intent to configure it — writing an instruction,
 * or touching any launch setting (resource, agent/model, or an attachment) —
 * so a blank objective from an idle field is never written at all.
 *
 * The card shows the same footer a real objective would (resource picker,
 * agent/model chooser, attachment trigger, Run) rather than a placeholder
 * message, so nothing about the surface changes shape the moment it saves.
 * Run itself stays disabled here: it needs a real objective id to launch, and
 * this card is never one — the instant any control above materializes it, the
 * mission's objective list gains a real row and this component is replaced by
 * the ordinary {@link DraftObjective} card, Run included.
 *
 * Creating with `state: 'draft'` matches the previous affordance: the server
 * promotes it to `future` automatically when a draft already exists, so the
 * queue keeps exactly one next-up objective.
 */
export function GhostObjective({
  missionId,
  projectId,
  onMaterialized,
  onDismissEmpty,
  autoFocus = false
}: GhostObjectiveProps) {
  const create = useCreateObjective();
  const qc = useQueryClient();
  const { mentionPaths, projectMentionOptions, missionMentionOptions } =
    useRepositoryMentionOptions(projectId);
  const resourcesQ = useProjectResources(projectId);
  // No real objective exists yet, so the agent/model default resolves the
  // same way a fresh objective's would — project preference, then catalog
  // default — via a synthetic id that setSelection never actually uses (see
  // below, it always gets the materialized id explicitly).
  const {
    catalog,
    agentConfigs,
    selection: defaultSelection,
    setSelection,
    commitLaunchConfig,
    loaded: selectionLoaded
  } = useObjectiveAgentSelection({
    id: '',
    projectId,
    assignedAgent: null,
    model: null,
    reasoningEffort: null
  });

  const [text, setText] = useState('');
  const textRef = useRef('');
  const [resourceKey, setResourceKey] = useState<string | null>(null);
  const [localSelection, setLocalSelection] = useState<AgentModelSelection | null>(null);
  const effectiveSelection = localSelection ?? defaultSelection;
  const [attachError, setAttachError] = useState<string | null>(null);
  const [isAttaching, setIsAttaching] = useState(false);
  const attachInputRef = useRef<HTMLInputElement>(null);

  const materializedRef = useRef(false);
  // Concurrent triggers (e.g. picking a resource and an agent in the same
  // instant) must share the same in-flight create rather than racing two.
  const materializingRef = useRef<Promise<ObjectiveDto | null> | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (autoFocus) textareaRef.current?.focus();
  }, [autoFocus]);

  const materialize = useCallback(() => {
    const instructionText = textRef.current.trim();
    if (!instructionText || materializedRef.current) return false;
    materializedRef.current = true;
    create.mutate(
      { missionId, instructionText, state: 'draft' },
      {
        // Let the user keep typing into a fresh composer if the write failed,
        // rather than silently dropping what they wrote.
        onError: () => {
          materializedRef.current = false;
        }
      }
    );
    return true;
  }, [create, missionId]);

  // Losing the card without a blur (panel close, route change) must not lose the
  // text the user already typed. Held in a ref so the cleanup runs on unmount
  // only, not on every re-render that gives `materialize` a new identity.
  const materializeRef = useRef(materialize);
  materializeRef.current = materialize;
  useEffect(() => {
    return () => {
      materializeRef.current();
    };
  }, []);

  /**
   * The setting-triggered counterpart to `materialize`: choosing a resource,
   * an agent/model, or an attachment is real configuring intent even with no
   * instruction text yet, so — unlike the text path above — this allows an
   * empty `instructionText`. Shares `materializedRef` with the text path so
   * whichever trigger fires first wins and the other becomes a no-op.
   */
  const materializeForSetting = useCallback(
    (overrides: { resourceKey?: string | null } = {}): Promise<ObjectiveDto | null> => {
      if (materializedRef.current) return Promise.resolve(null);
      if (materializingRef.current) return materializingRef.current;
      materializedRef.current = true;
      const promise = create
        .mutateAsync({
          missionId,
          instructionText: textRef.current.trim(),
          state: 'draft',
          ...(overrides.resourceKey !== undefined ? { resourceKey: overrides.resourceKey } : {})
        })
        .catch((err: unknown) => {
          materializedRef.current = false;
          throw err;
        })
        .finally(() => {
          materializingRef.current = null;
        });
      materializingRef.current = promise;
      return promise;
    },
    [create, missionId]
  );

  const handleResourceChange = useCallback(
    (nextKey: string | null) => {
      setResourceKey(nextKey);
      materializeForSetting({ resourceKey: nextKey }).then(
        created => {
          if (created) onMaterialized?.();
        },
        () => undefined
      );
    },
    [materializeForSetting, onMaterialized]
  );

  const handleAgentSelectionChange = useCallback(
    async (next: AgentModelSelection) => {
      setLocalSelection(next);
      const created = await materializeForSetting();
      if (!created) return;
      await setSelection(next, created.id);
      onMaterialized?.();
    },
    [materializeForSetting, setSelection, onMaterialized]
  );

  const handleLaunchConfigCommit = useCallback(
    async (agentKey: string, config: AgentLaunchConfigDto) => {
      const created = await materializeForSetting();
      if (!created) return;
      commitLaunchConfig(agentKey, config, created.id);
      onMaterialized?.();
    },
    [commitLaunchConfig, materializeForSetting, onMaterialized]
  );

  const handleAttachmentFiles = useCallback(
    async (files: File[]) => {
      setAttachError(null);
      setIsAttaching(true);
      try {
        const created = await materializeForSetting();
        if (!created) return;
        onMaterialized?.();
        for (const file of files) {
          if (file.size > MAX_ATTACHMENT_BYTES) {
            setAttachError(
              `File too large. Attachments can be no longer than ${MAX_ATTACHMENT_LABEL}.`
            );
            continue;
          }
          await api.uploadObjectiveAttachment(created.id, file);
        }
        void qc.invalidateQueries({ queryKey: keys.objectiveAttachments(created.id) });
      } catch (err) {
        setAttachError(err instanceof Error ? err.message : 'Failed to upload attachment.');
      } finally {
        setIsAttaching(false);
      }
    },
    [materializeForSetting, onMaterialized, qc]
  );

  const handleAttachmentInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      if (event.target.files && event.target.files.length > 0) {
        void handleAttachmentFiles(Array.from(event.target.files));
        event.target.value = '';
      }
    },
    [handleAttachmentFiles]
  );

  const handleBlur = () => {
    if (materialize()) {
      setText('');
      textRef.current = '';
      onMaterialized?.();
      return;
    }
    if (!textRef.current.trim()) onDismissEmpty?.();
  };

  const errorMessage = create.isError ? (create.error as Error).message : attachError;

  return (
    <FileDropZone
      onDrop={handleAttachmentFiles}
      disabled={isAttaching}
      className={cn(
        'w-full overflow-hidden rounded-xl border border-dashed border-muted-foreground/25',
        'transition-all focus-within:border-solid focus-within:border-muted-foreground/20',
        'focus-within:shadow-md focus-within:ring-1 focus-within:ring-ring/50 md:min-w-[350px]'
      )}
    >
      <div className="px-3 pb-2 pt-3">
        <MentionableTextarea
          ref={textareaRef}
          value={text}
          onValueChange={next => {
            textRef.current = next;
            setText(next);
          }}
          mentionPaths={mentionPaths}
          projectMentionOptions={projectMentionOptions}
          missionMentionOptions={missionMentionOptions}
          autoListContinuation="enter"
          maxHeightPx={360}
          rows={2}
          aria-label="New objective instruction"
          placeholder="Describe what the agent should do… (@ file, # project, $ mission)"
          className="min-h-[3.25em] border-none bg-transparent text-base font-medium text-foreground/90"
          onBlur={handleBlur}
          onKeyDown={event => {
            if (event.key === 'Escape') {
              event.preventDefault();
              textRef.current = '';
              setText('');
              setResourceKey(null);
              setLocalSelection(null);
              onDismissEmpty?.();
              return;
            }
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              if (materialize()) {
                setText('');
                textRef.current = '';
                onMaterialized?.();
              }
            }
          }}
        />
      </div>

      <div className="border-t border-border/40">
        {errorMessage ? (
          <p className="px-3 pb-1 pt-1.5 text-xs text-destructive">{errorMessage}</p>
        ) : null}
        <ObjectiveAttachmentUploadTrigger
          attachmentsCount={0}
          inputRef={attachInputRef}
          onInputChange={handleAttachmentInputChange}
          disabled={isAttaching}
        >
          <ObjectiveResourcePicker
            resources={resourcesQ.data ?? []}
            value={resourceKey}
            disabled={create.isPending}
            onChange={handleResourceChange}
          />

          <AgentModelChooserButton
            catalog={catalog}
            selection={effectiveSelection}
            onChange={handleAgentSelectionChange}
            agentConfigs={agentConfigs}
            onLaunchConfigCommit={(agentKey, config) =>
              void handleLaunchConfigCommit(agentKey, config)
            }
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
                ? 'Save this objective — write an instruction or set an option above — to enable Run.'
                : 'Loading your agent model selection.'}
            </TooltipContent>
          </Tooltip>
        </ObjectiveAttachmentUploadTrigger>
      </div>
    </FileDropZone>
  );
}
