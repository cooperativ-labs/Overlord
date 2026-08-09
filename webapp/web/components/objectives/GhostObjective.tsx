import { useCallback, useEffect, useRef, useState } from 'react';

import { useCreateObjective } from '../../lib/queries.ts';
import { useRepositoryMentionOptions } from '../../lib/useRepositoryMentionOptions.ts';
import { cn } from '../../lib/utils.ts';
import { MentionableTextarea } from '../MentionableTextarea.tsx';

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
 * moment it actually has content — on blur, ⌘/Ctrl+Enter, or unmount — so a
 * blank objective is never written at all.
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
  const { mentionPaths, projectMentionOptions, missionMentionOptions } =
    useRepositoryMentionOptions(projectId);
  const [text, setText] = useState('');
  const textRef = useRef('');
  const materializedRef = useRef(false);
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

  const handleBlur = () => {
    if (materialize()) {
      setText('');
      textRef.current = '';
      onMaterialized?.();
      return;
    }
    if (!textRef.current.trim()) onDismissEmpty?.();
  };

  return (
    <div
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
      <div className="border-t border-border/40 px-3 py-1.5">
        <p className="text-xs text-muted-foreground">
          {create.isError
            ? (create.error as Error).message
            : 'Saved as an objective once you write something — agent, files, and run controls appear then.'}
        </p>
      </div>
    </div>
  );
}
