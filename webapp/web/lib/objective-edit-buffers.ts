import { useSyncExternalStore } from 'react';

/**
 * Unsaved objective title and instruction edits, keyed by objective id and field
 * (mission-panel-redesign plan §9.8).
 *
 * The objective detail lets a person type, then switch tab, step to the previous or next
 * objective, close the dialog, press browser Back, or press Run, all within the debounce window
 * of the editor's autosave. Component state and the editor's own timer cannot carry text across
 * those transitions, and a `void` save cannot tell the caller that the text actually landed. So:
 *
 * - the text lives here, outside the tree, under `<objectiveId>:<field>`, and an editor for a
 *   different objective can never read another objective's buffer;
 * - each mounted editor registers a saver, and {@link flushObjectiveEdits} awaits every
 *   registered save (or one objective's) before navigation or launch: the awaitable boundary;
 * - a failed save keeps the buffer with `status: 'error'` and its message, so the editor shows
 *   the error with a retry and the caller can refuse to navigate away.
 *
 * Summary edits keep their own store (`objective-summary-buffers.ts`); flushing never saves a
 * summary, because a summary edit is an explicit Save/Cancel form, not an autosaving field.
 */

export type ObjectiveEditField = 'title' | 'instruction';

export type ObjectiveEditBuffer = {
  objectiveId: string;
  field: ObjectiveEditField;
  /** The person's current text. */
  text: string;
  /** The last text the server acknowledged for this edit (or the value the edit started from). */
  savedText: string;
  status: 'editing' | 'saving' | 'error';
  /** Present when `status` is `error`. */
  error?: string;
};

/** Persist the given text. Resolves on success; rejects (or resolves `false`) on failure. */
export type ObjectiveEditSaver = (text: string) => Promise<unknown>;

const buffers = new Map<string, ObjectiveEditBuffer>();
const savers = new Map<string, ObjectiveEditSaver>();
/** In-flight saves, so a flush waits for a save already running instead of starting another. */
const inFlight = new Map<string, Promise<boolean>>();
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function objectiveEditKey(objectiveId: string, field: ObjectiveEditField): string {
  return `${objectiveId}:${field}`;
}

export function getObjectiveEditBuffer(
  objectiveId: string,
  field: ObjectiveEditField
): ObjectiveEditBuffer | undefined {
  return buffers.get(objectiveEditKey(objectiveId, field));
}

/** Open an edit (no-op when one is already open: the existing text wins). */
export function beginObjectiveEdit(objectiveId: string, field: ObjectiveEditField, value: string) {
  const key = objectiveEditKey(objectiveId, field);
  if (buffers.has(key)) return;
  buffers.set(key, { objectiveId, field, text: value, savedText: value, status: 'editing' });
  emit();
}

export function updateObjectiveEditText(
  objectiveId: string,
  field: ObjectiveEditField,
  text: string
) {
  const key = objectiveEditKey(objectiveId, field);
  const current = buffers.get(key);
  if (!current) return;
  // Typing after a failure keeps the error visible until the next save attempt resolves it.
  buffers.set(key, { ...current, text });
  emit();
}

export function discardObjectiveEdit(objectiveId: string, field: ObjectiveEditField) {
  if (!buffers.delete(objectiveEditKey(objectiveId, field))) return;
  emit();
}

/** Register the saver for a mounted editor. Returns the unregister function. */
export function registerObjectiveEditSaver(
  objectiveId: string,
  field: ObjectiveEditField,
  saver: ObjectiveEditSaver
): () => void {
  const key = objectiveEditKey(objectiveId, field);
  savers.set(key, saver);
  return () => {
    if (savers.get(key) === saver) savers.delete(key);
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'Could not save. Your text is kept.';
}

/**
 * Save one buffer's current text. `finish` ends the edit on success (blur, flush before
 * navigation); otherwise the edit stays open (debounced autosave while typing). The saved text is
 * recorded so a later flush does not resend it. A failure keeps the buffer with the error.
 */
export function saveObjectiveEdit(
  objectiveId: string,
  field: ObjectiveEditField,
  { finish }: { finish: boolean }
): Promise<boolean> {
  const key = objectiveEditKey(objectiveId, field);
  const running = inFlight.get(key);
  if (running) {
    // Let the running save land, then save again if the text moved on (or to finish the edit).
    return running.then(() => saveObjectiveEdit(objectiveId, field, { finish }));
  }
  const buffer = buffers.get(key);
  if (!buffer) return Promise.resolve(true);
  const saver = savers.get(key);
  const text = buffer.text;
  if (text === buffer.savedText && buffer.status !== 'error') {
    if (finish) discardObjectiveEdit(objectiveId, field);
    return Promise.resolve(true);
  }
  if (!saver) {
    // No mounted editor can persist it: keep the text for when one remounts.
    return Promise.resolve(false);
  }
  buffers.set(key, { ...buffer, status: 'saving', error: undefined });
  emit();
  const attempt = (async () => {
    try {
      const result = await saver(text);
      if (result === false) throw new Error('Could not save. Your text is kept.');
      const latest = buffers.get(key);
      if (!latest) return true;
      if (finish && latest.text === text) {
        buffers.delete(key);
      } else {
        buffers.set(key, { ...latest, savedText: text, status: 'editing', error: undefined });
      }
      emit();
      return true;
    } catch (error) {
      const latest = buffers.get(key);
      if (latest) {
        buffers.set(key, { ...latest, status: 'error', error: errorMessage(error) });
        emit();
      }
      return false;
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, attempt);
  // A navigation/Run flush must include typing that happened during this request,
  // not just the snapshot it started saving. Do not retry failures implicitly.
  return finish
    ? attempt.then(ok =>
        ok && buffers.has(key) ? saveObjectiveEdit(objectiveId, field, { finish: true }) : ok
      )
    : attempt;
}

/**
 * The awaitable save boundary: save and finish every open edit (or only one objective's) before
 * navigation, close, tab changes that unmount editors, or launch. Resolves `true` only when every
 * buffer saved; on `false` the failed buffers keep their text and error for retry.
 */
export async function flushObjectiveEdits(objectiveId?: string): Promise<boolean> {
  const targets = [...buffers.values()].filter(
    buffer => objectiveId === undefined || buffer.objectiveId === objectiveId
  );
  const results = await Promise.all(
    targets.map(buffer => saveObjectiveEdit(buffer.objectiveId, buffer.field, { finish: true }))
  );
  return results.every(Boolean);
}

/** Whether an objective has an open edit (any field). */
export function hasObjectiveEdits(objectiveId: string): boolean {
  for (const buffer of buffers.values()) if (buffer.objectiveId === objectiveId) return true;
  return false;
}

/** Test hook: forget every buffer, saver and in-flight save. */
export function resetObjectiveEditBuffers() {
  buffers.clear();
  savers.clear();
  inFlight.clear();
  emit();
}

/** The live buffer for one objective field, or undefined when no edit is open. */
export function useObjectiveEditBuffer(
  objectiveId: string,
  field: ObjectiveEditField
): ObjectiveEditBuffer | undefined {
  const key = objectiveEditKey(objectiveId, field);
  return useSyncExternalStore(
    subscribe,
    () => buffers.get(key),
    () => buffers.get(key)
  );
}

/**
 * Escape precedence (plan §9.1, §9.8): an editor or nested popup that handles Escape marks the
 * native event, and the objective dialog refuses to close for a marked event. This works whether
 * or not the event's propagation reached the dialog's own listener.
 */
const consumedEscapes = new WeakSet<Event>();

export function markEscapeConsumed(event: Event | { nativeEvent: Event }) {
  consumedEscapes.add('nativeEvent' in event ? event.nativeEvent : event);
}

export function isEscapeConsumed(event: Event | undefined | null): boolean {
  return Boolean(event && consumedEscapes.has(event));
}
