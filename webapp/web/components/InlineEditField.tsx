import { Pencil } from 'lucide-react';
import * as React from 'react';

import {
  MentionableTextarea,
  type MissionMentionOption,
  type ProjectMentionOption
} from '@/components/MentionableTextarea';
import { Input } from '@/components/ui/input';
import {
  beginObjectiveEdit,
  discardObjectiveEdit,
  markEscapeConsumed,
  type ObjectiveEditField,
  registerObjectiveEditSaver,
  saveObjectiveEdit,
  updateObjectiveEditText,
  useObjectiveEditBuffer
} from '@/lib/objective-edit-buffers';
import { cn } from '@/lib/utils';

export type InlineEditFieldProps = {
  value: string;
  /**
   * Persist the edited value. May return a promise: in buffered mode (`buffer`) its settlement
   * decides whether the edit finished or failed (the text is kept with a retry on failure).
   */
  onSave: (next: string) => void | Promise<unknown>;
  /** Edit in a multiline, mention-aware textarea instead of a single-line input. */
  multiline?: boolean;
  /** Classes applied to the static display element. */
  className?: string;
  /** Shown (italic, muted) when the value is empty. */
  placeholder?: string;
  /** Classes applied to the input/textarea while editing. */
  inputClassName?: string;
  /** File paths offered for `@` mentions (multiline only). */
  mentionPaths?: string[];
  /** Projects offered for `#` mentions (multiline only). */
  projectMentionOptions?: ProjectMentionOption[];
  /** Missions offered for `$` mentions (multiline only). */
  missionMentionOptions?: MissionMentionOption[];
  /** Render the value as static, non-editable text. */
  disabled?: boolean;
  /**
   * Commit an empty trimmed value instead of reverting to the previous value.
   * Empty commits only ever fire when the edit finishes (blur, ⌘/Ctrl+Enter),
   * never from the debounced autosave — otherwise clearing a field to retype it
   * would fire the caller's "value is now empty" handling mid-keystroke.
   */
  commitEmpty?: boolean;
  /** Accessible label for the editor. */
  ariaLabel?: string;
  /** Minimum visible line count when `multiline` (display + edit modes). */
  minRows?: number;
  /** Also save ~300ms after the user stops typing, instead of only on blur. Default `true`. */
  debounceSaveOnChange?: boolean;
  /**
   * Keep the draft in the objective-keyed edit buffer store (plan §9.8) instead of component
   * state. The text then survives remounts, tab changes and objective switches; the editor
   * registers an awaitable saver with `flushObjectiveEdits`; a failed save keeps the text and
   * shows the error with Retry and Discard.
   */
  buffer?: { objectiveId: string; field: ObjectiveEditField };
  /** Enter edit mode on mount (e.g. "Edit title" from a row menu). */
  autoEdit?: boolean;
  /**
   * Accessible name of a pencil button rendered after the value, so the field can be edited from
   * the keyboard (the display text itself is not focusable).
   */
  editButtonLabel?: string;
  /** Ref to the active input or textarea while editing (initial focus). */
  editorRef?: React.Ref<HTMLInputElement | HTMLTextAreaElement>;
};

/** Matches `leading-relaxed` (1.625) used on objective instruction surfaces. */
function minRowsMinHeightStyle(minRows: number): React.CSSProperties {
  return { minHeight: `${minRows * 1.625}em` };
}

const DEBOUNCE_SAVE_MS = 300;

/**
 * Inline click-to-edit text. Displays a value that turns into an editor on
 * click: a single-line input, or — when `multiline` — a {@link MentionableTextarea}
 * with `@` file, `#` project, and `$` mission mentions, markdown list
 * continuation, and Save/Cancel affordances. Commits on blur or ⌘/Ctrl+Enter;
 * Escape cancels.
 *
 * Extracted from the former `EditableText` in `ui.tsx` and modelled on the
 * inline-edit pattern shared across the objective and mission surfaces.
 */
export function InlineEditField({
  value,
  onSave,
  multiline = false,
  className,
  placeholder = 'Click to edit',
  inputClassName,
  mentionPaths,
  projectMentionOptions,
  missionMentionOptions,
  disabled = false,
  commitEmpty = false,
  ariaLabel,
  minRows,
  debounceSaveOnChange = true,
  buffer,
  autoEdit = false,
  editButtonLabel,
  editorRef
}: InlineEditFieldProps) {
  if (buffer) {
    return (
      <BufferedInlineEditField
        value={value}
        onSave={onSave}
        multiline={multiline}
        className={className}
        placeholder={placeholder}
        inputClassName={inputClassName}
        mentionPaths={mentionPaths}
        projectMentionOptions={projectMentionOptions}
        missionMentionOptions={missionMentionOptions}
        disabled={disabled}
        commitEmpty={commitEmpty}
        ariaLabel={ariaLabel}
        minRows={minRows}
        debounceSaveOnChange={debounceSaveOnChange}
        buffer={buffer}
        autoEdit={autoEdit}
        editButtonLabel={editButtonLabel}
        editorRef={editorRef}
      />
    );
  }
  return (
    <LocalInlineEditField
      value={value}
      onSave={onSave}
      multiline={multiline}
      className={className}
      placeholder={placeholder}
      inputClassName={inputClassName}
      mentionPaths={mentionPaths}
      projectMentionOptions={projectMentionOptions}
      missionMentionOptions={missionMentionOptions}
      disabled={disabled}
      commitEmpty={commitEmpty}
      ariaLabel={ariaLabel}
      minRows={minRows}
      debounceSaveOnChange={debounceSaveOnChange}
      autoEdit={autoEdit}
      editButtonLabel={editButtonLabel}
      editorRef={editorRef}
    />
  );
}

/** The original click-to-edit field: draft in component state, fire-and-forget saves. */
function LocalInlineEditField({
  value,
  onSave,
  multiline = false,
  className,
  placeholder = 'Click to edit',
  inputClassName,
  mentionPaths,
  projectMentionOptions,
  missionMentionOptions,
  disabled = false,
  commitEmpty = false,
  ariaLabel,
  minRows,
  debounceSaveOnChange = true,
  autoEdit = false,
  editButtonLabel,
  editorRef
}: Omit<InlineEditFieldProps, 'buffer'>) {
  const multilineMinRowsStyle = multiline && minRows ? minRowsMinHeightStyle(minRows) : undefined;
  const [editing, setEditing] = React.useState(autoEdit && !disabled);
  const [draft, setDraft] = React.useState(value);
  const draftRef = React.useRef(value);
  const saveTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  // Skip while editing so an autosave round-trip (debounced onChange below)
  // doesn't clobber keystrokes typed after the save fired but before the
  // updated `value` prop comes back from the server.
  React.useEffect(() => {
    if (editing) return;
    setDraft(value);
    draftRef.current = value;
  }, [value, editing]);

  const clearPendingSave = React.useCallback(() => {
    if (saveTimeoutRef.current === null) return;
    clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = null;
  }, []);

  React.useEffect(() => clearPendingSave, [clearPendingSave]);

  // Focus and place the caret at the end when entering multiline edit mode.
  React.useEffect(() => {
    if (!editing || !multiline) return;
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    const end = el.value.length;
    el.setSelectionRange(end, end);
  }, [editing, multiline]);

  const commit = React.useCallback(() => {
    clearPendingSave();
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed && trimmed !== value) void onSave(trimmed);
    else if (!trimmed && commitEmpty) void onSave('');
    else setDraft(value);
  }, [clearPendingSave, commitEmpty, draft, value, onSave]);

  const cancel = React.useCallback(() => {
    clearPendingSave();
    setDraft(value);
    setEditing(false);
  }, [clearPendingSave, value]);

  // Mirrors `setDraft`, additionally (re)scheduling a debounced autosave so
  // edits persist ~300ms after the user pauses, on top of the on-blur commit.
  const updateDraft = React.useCallback(
    (next: string) => {
      draftRef.current = next;
      setDraft(next);
      if (!debounceSaveOnChange) return;
      clearPendingSave();
      saveTimeoutRef.current = setTimeout(() => {
        saveTimeoutRef.current = null;
        const trimmed = draftRef.current.trim();
        // Deliberately no empty commit here — see `commitEmpty`. An empty
        // autosave is indistinguishable from "user is still mid-edit", and
        // callers treat it as a destructive signal (deleting the objective).
        if (trimmed && trimmed !== value) void onSave(trimmed);
      }, DEBOUNCE_SAVE_MS);
    },
    [clearPendingSave, debounceSaveOnChange, onSave, value]
  );

  if (disabled || !editing) {
    return (
      <InlineEditDisplay
        value={value}
        placeholder={placeholder}
        className={className}
        style={multilineMinRowsStyle}
        disabled={disabled}
        onStartEditing={() => setEditing(true)}
        editButtonLabel={editButtonLabel}
      />
    );
  }

  if (multiline) {
    return (
      <MentionableTextarea
        ref={mergeRefs(textareaRef, editorRef)}
        value={draft}
        onValueChange={updateDraft}
        mentionPaths={mentionPaths}
        projectMentionOptions={projectMentionOptions}
        missionMentionOptions={missionMentionOptions}
        autoListContinuation="enter"
        maxHeightPx={360}
        rows={minRows}
        aria-label={ariaLabel}
        style={multilineMinRowsStyle}
        className={cn('border-none bg-transparent', inputClassName)}
        // Clicking outside (anywhere but the mention menu, whose buttons
        // preventDefault on mousedown to keep focus) commits the edit.
        onBlur={commit}
        onKeyDown={event => {
          if (event.key === 'Escape') {
            event.preventDefault();
            markEscapeConsumed(event);
            cancel();
            return;
          }
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            commit();
          }
        }}
      />
    );
  }

  return (
    <Input
      autoFocus
      ref={editorRef as React.Ref<HTMLInputElement>}
      value={draft}
      className={cn(
        'h-full max-h-40 border-none bg-transparent hover:bg-transparent',
        inputClassName
      )}
      aria-label={ariaLabel}
      onChange={event => updateDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={event => {
        if (event.key === 'Escape') {
          markEscapeConsumed(event);
          cancel();
          return;
        }
        if (event.key === 'Enter') {
          event.preventDefault();
          commit();
        }
      }}
    />
  );
}

function mergeRefs<T>(...refs: Array<React.Ref<T> | undefined>): React.RefCallback<T> {
  return node => {
    for (const ref of refs) {
      if (typeof ref === 'function') ref(node);
      else if (ref) (ref as React.MutableRefObject<T | null>).current = node;
    }
  };
}

/** Read mode: the value (click to edit) and, when labelled, a keyboard-operable edit button. */
function InlineEditDisplay({
  value,
  placeholder,
  className,
  style,
  disabled,
  onStartEditing,
  editButtonLabel
}: {
  value: string;
  placeholder: string;
  className?: string;
  style?: React.CSSProperties;
  disabled: boolean;
  onStartEditing: () => void;
  editButtonLabel?: string;
}) {
  const text = (
    <span
      className={cn(
        'rounded max-h-[360px] overflow-y-auto',
        style && 'block',
        !disabled && 'cursor-default',
        className,
        value ? '' : 'italic text-muted-foreground'
      )}
      style={style}
      onClick={disabled ? undefined : onStartEditing}
      title={disabled ? undefined : 'Click to edit'}
    >
      {value || placeholder}
    </span>
  );
  if (disabled || !editButtonLabel) return text;
  return (
    <span className="flex min-w-0 items-start gap-1">
      <span className="min-w-0 flex-1">{text}</span>
      <button
        type="button"
        aria-label={editButtonLabel}
        title={editButtonLabel}
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
        onClick={onStartEditing}
      >
        <Pencil className="size-3.5" aria-hidden="true" />
      </button>
    </span>
  );
}

/**
 * Buffered mode (plan §9.8): the draft lives in the objective-keyed buffer store, saves are
 * awaited, and a failed save keeps the text with Retry and Discard. Leaving the editor (blur,
 * ⌘/Ctrl+Enter, or an external flush) finishes the edit only once the save succeeds.
 */
function BufferedInlineEditField({
  value,
  onSave,
  multiline = false,
  className,
  placeholder = 'Click to edit',
  inputClassName,
  mentionPaths,
  projectMentionOptions,
  missionMentionOptions,
  disabled = false,
  commitEmpty = false,
  ariaLabel,
  minRows,
  debounceSaveOnChange = true,
  buffer: bufferTarget,
  autoEdit = false,
  editButtonLabel,
  editorRef
}: InlineEditFieldProps & { buffer: NonNullable<InlineEditFieldProps['buffer']> }) {
  const { objectiveId, field } = bufferTarget;
  const multilineMinRowsStyle = multiline && minRows ? minRowsMinHeightStyle(minRows) : undefined;
  const buffer = useObjectiveEditBuffer(objectiveId, field);
  const saveTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const onSaveRef = React.useRef(onSave);
  onSaveRef.current = onSave;
  const valueRef = React.useRef(value);
  valueRef.current = value;
  const editing = buffer !== undefined && !disabled;

  // Register the awaitable saver for this objective field while mounted.
  React.useEffect(
    () =>
      registerObjectiveEditSaver(objectiveId, field, async text => {
        const trimmed = text.trim();
        if (!trimmed && !commitEmpty) return true; // reverts: an empty value is not saved
        if (trimmed === valueRef.current.trim()) return true;
        await onSaveRef.current(trimmed);
        return true;
      }),
    [commitEmpty, field, objectiveId]
  );

  const clearPendingSave = React.useCallback(() => {
    if (saveTimeoutRef.current === null) return;
    clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = null;
  }, []);
  // Unmounting cancels only the timer: the buffer (and so the text) stays for the flush boundary.
  React.useEffect(() => clearPendingSave, [clearPendingSave]);

  React.useEffect(() => {
    if (autoEdit && !disabled) beginObjectiveEdit(objectiveId, field, valueRef.current);
  }, [autoEdit, disabled, field, objectiveId]);

  React.useEffect(() => {
    if (!editing || !multiline) return;
    const el = textareaRef.current;
    if (!el || document.activeElement === el) return;
    el.focus();
    const end = el.value.length;
    el.setSelectionRange(end, end);
  }, [editing, multiline]);

  const start = () => beginObjectiveEdit(objectiveId, field, value);
  const commit = () => {
    clearPendingSave();
    void saveObjectiveEdit(objectiveId, field, { finish: true });
  };
  const cancel = () => {
    clearPendingSave();
    discardObjectiveEdit(objectiveId, field);
  };
  const updateDraft = (next: string) => {
    updateObjectiveEditText(objectiveId, field, next);
    if (!debounceSaveOnChange) return;
    clearPendingSave();
    saveTimeoutRef.current = setTimeout(() => {
      saveTimeoutRef.current = null;
      // No empty autosave: an emptied field is only committed when the edit finishes.
      if (next.trim()) void saveObjectiveEdit(objectiveId, field, { finish: false });
    }, DEBOUNCE_SAVE_MS);
  };
  const onEscape = (event: React.KeyboardEvent) => {
    event.preventDefault();
    event.stopPropagation();
    markEscapeConsumed(event);
    cancel();
  };

  if (!editing) {
    return (
      <InlineEditDisplay
        value={value}
        placeholder={placeholder}
        className={className}
        style={multilineMinRowsStyle}
        disabled={disabled}
        onStartEditing={start}
        editButtonLabel={editButtonLabel}
      />
    );
  }

  const status = buffer.status;
  const footer =
    status === 'error' ? (
      <div role="alert" className="mt-1 flex flex-wrap items-center gap-2 text-xs text-destructive">
        <span>{buffer.error ?? 'Could not save. Your text is kept.'}</span>
        <button
          type="button"
          className="rounded-sm font-medium underline-offset-2 hover:underline"
          onMouseDown={event => event.preventDefault()}
          onClick={() => void saveObjectiveEdit(objectiveId, field, { finish: true })}
        >
          Retry
        </button>
        <button
          type="button"
          className="rounded-sm font-medium text-muted-foreground underline-offset-2 hover:underline"
          onMouseDown={event => event.preventDefault()}
          onClick={cancel}
        >
          Discard
        </button>
      </div>
    ) : status === 'saving' ? (
      <p className="mt-1 text-[11px] text-muted-foreground" role="status">
        Saving…
      </p>
    ) : null;

  if (multiline) {
    return (
      <div className="min-w-0">
        <MentionableTextarea
          ref={mergeRefs(textareaRef, editorRef)}
          value={buffer.text}
          onValueChange={updateDraft}
          mentionPaths={mentionPaths}
          projectMentionOptions={projectMentionOptions}
          missionMentionOptions={missionMentionOptions}
          autoListContinuation="enter"
          maxHeightPx={360}
          rows={minRows}
          aria-label={ariaLabel}
          aria-invalid={status === 'error' || undefined}
          style={multilineMinRowsStyle}
          className={cn('border-none bg-transparent', inputClassName)}
          onBlur={commit}
          onKeyDown={event => {
            if (event.key === 'Escape') {
              onEscape(event);
              return;
            }
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              commit();
            }
          }}
        />
        {footer}
      </div>
    );
  }

  return (
    <div className="min-w-0">
      <Input
        autoFocus
        ref={editorRef as React.Ref<HTMLInputElement>}
        value={buffer.text}
        className={cn(
          'h-full max-h-40 border-none bg-transparent hover:bg-transparent',
          inputClassName
        )}
        aria-label={ariaLabel}
        aria-invalid={status === 'error' || undefined}
        onChange={event => updateDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={event => {
          if (event.key === 'Escape') {
            onEscape(event);
            return;
          }
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          }
        }}
      />
      {footer}
    </div>
  );
}

/**
 * Backwards-compatible alias for {@link InlineEditField}. Prefer
 * `InlineEditField` in new code.
 */
export const EditableText = InlineEditField;
