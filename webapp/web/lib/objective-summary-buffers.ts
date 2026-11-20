import { useSyncExternalStore } from 'react';

/**
 * Unsaved summary edits, keyed by objective id (coo:1275 plan §4.12).
 *
 * A summary editor's text must survive everything that can happen to its card while the
 * person types: a drag that makes it the queue head or a compact card, a stale-reorder
 * rollback, a realtime refetch that brings a newly generated summary, and the launch that
 * moves the card from the queue to the launching group (a different parent, so React
 * remounts it). Component state cannot survive the last one, so the buffer lives here,
 * outside the tree, until the person saves or cancels.
 *
 * `baseRevision` is the `summaryRevision` the edit started from; the save sends it as
 * `expectedSummaryRevision` so a concurrent change answers 409 instead of being
 * silently overwritten.
 */
export type SummaryEditBuffer = {
  text: string;
  baseRevision: number;
  /** The server text when a save hit `summary_conflict`; the buffer is kept. */
  conflictText?: string | null;
};

const buffers = new Map<string, SummaryEditBuffer>();
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSummaryBuffer(objectiveId: string): SummaryEditBuffer | undefined {
  return buffers.get(objectiveId);
}

export function setSummaryBuffer(objectiveId: string, buffer: SummaryEditBuffer) {
  buffers.set(objectiveId, buffer);
  emit();
}

export function updateSummaryBuffer(objectiveId: string, patch: Partial<SummaryEditBuffer>) {
  const current = buffers.get(objectiveId);
  if (!current) return;
  buffers.set(objectiveId, { ...current, ...patch });
  emit();
}

export function clearSummaryBuffer(objectiveId: string) {
  if (!buffers.delete(objectiveId)) return;
  emit();
}

/** Test hook: forget every buffer. */
export function resetSummaryBuffers() {
  buffers.clear();
  emit();
}

/** The live buffer for one objective, or undefined when no edit is open. */
export function useSummaryBuffer(objectiveId: string): SummaryEditBuffer | undefined {
  return useSyncExternalStore(
    subscribe,
    () => buffers.get(objectiveId),
    () => buffers.get(objectiveId)
  );
}
