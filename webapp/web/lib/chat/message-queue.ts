import type { ChatKnowledgebaseWriteDto, ChatRunDto } from '@overlord/contract';
import { useCallback, useSyncExternalStore } from 'react';

/**
 * Messages typed while the assistant is busy wait here and are sent one at a time,
 * in order, once the thread can take a new message. Pure transitions live below so
 * the composer, the drain effect and the tests share one set of rules; the small
 * store keeps each thread's queue in memory (keyed by scope and thread) so it survives
 * switching between conversations but never crosses into another thread.
 */
export interface QueuedChatMessage {
  id: string;
  text: string;
  /** The per-request Knowledgebase grant chosen when the message was queued. */
  knowledgebaseWrite: ChatKnowledgebaseWriteDto | null;
}

export interface ChatMessageQueue {
  items: QueuedChatMessage[];
  /** The head item currently being submitted; it stays listed until accepted. */
  sendingId: string | null;
  /** The item open for editing; the head is not sent while it is being edited. */
  editingId: string | null;
  /** Draining stopped after a failed send or a stopped run until the user resumes. */
  paused: 'failed' | 'stopped' | null;
  /** The last stopped run already accounted for, so it pauses the queue only once. */
  acknowledgedRunId: string | null;
}

export const EMPTY_QUEUE: ChatMessageQueue = {
  items: [],
  sendingId: null,
  editingId: null,
  paused: null,
  acknowledgedRunId: null
};

export function enqueue(queue: ChatMessageQueue, item: QueuedChatMessage): ChatMessageQueue {
  const text = item.text.trim();
  if (!text) return queue;
  // Queueing another message is the user asking to carry on.
  return { ...queue, items: [...queue.items, { ...item, text }], paused: null };
}

export function removeQueued(queue: ChatMessageQueue, id: string): ChatMessageQueue {
  if (queue.sendingId === id) return queue;
  const items = queue.items.filter(item => item.id !== id);
  return {
    ...queue,
    items,
    editingId: queue.editingId === id ? null : queue.editingId,
    paused: items.length === 0 ? null : queue.paused
  };
}

export function startEditing(queue: ChatMessageQueue, id: string): ChatMessageQueue {
  if (queue.sendingId === id || !queue.items.some(item => item.id === id)) return queue;
  return { ...queue, editingId: id };
}

export function cancelEditing(queue: ChatMessageQueue): ChatMessageQueue {
  return queue.editingId ? { ...queue, editingId: null } : queue;
}

/** Saves an edit; empty text removes the message. */
export function saveEdit(queue: ChatMessageQueue, id: string, text: string): ChatMessageQueue {
  const value = text.trim();
  if (!value) return removeQueued(queue, id);
  if (queue.sendingId === id) return queue;
  return {
    ...queue,
    items: queue.items.map(item => (item.id === id ? { ...item, text: value } : item)),
    editingId: queue.editingId === id ? null : queue.editingId
  };
}

export function resume(queue: ChatMessageQueue): ChatMessageQueue {
  return queue.paused ? { ...queue, paused: null } : queue;
}

/** What the thread can do with the queue right now. */
export interface DrainContext {
  /** `composerMode` of the thread. Only `send` may take a queued message. */
  mode: 'send' | 'answer' | 'busy';
  /** A message typed straight into the composer is being submitted. */
  composerSending: boolean;
  latestRun: ChatRunDto | null;
}

export type DrainDecision =
  | { kind: 'wait' }
  | { kind: 'send'; item: QueuedChatMessage }
  | { kind: 'pause'; runId: string };

/**
 * Decides the next step for the queue. A queued message is sent only while the thread
 * is idle (`send` mode: no run queued, running or waiting for an answer, so a queued
 * message is never mistaken for an answer), nothing else is in flight, and the head is
 * not being edited. A run the user stopped pauses the queue instead of firing the next
 * message straight after Stop.
 */
export function drainDecision(queue: ChatMessageQueue, context: DrainContext): DrainDecision {
  const head = queue.items[0];
  if (!head || queue.sendingId || queue.paused) return { kind: 'wait' };
  if (context.mode !== 'send' || context.composerSending) return { kind: 'wait' };
  const run = context.latestRun;
  if (run?.state === 'cancelled' && run.id !== queue.acknowledgedRunId)
    return { kind: 'pause', runId: run.id };
  if (queue.editingId === head.id) return { kind: 'wait' };
  return { kind: 'send', item: head };
}

export function pauseForStoppedRun(queue: ChatMessageQueue, runId: string): ChatMessageQueue {
  return { ...queue, paused: 'stopped', acknowledgedRunId: runId };
}

/** Marks the head as sending; returns the same queue when it is not sendable. */
export function beginSend(queue: ChatMessageQueue, id: string): ChatMessageQueue {
  if (queue.sendingId || queue.items[0]?.id !== id) return queue;
  return { ...queue, sendingId: id };
}

/**
 * Settles a claimed send. `busy` (the server already had a run the client had not
 * seen) keeps the message queued for after that run; `failed` keeps it and pauses
 * the queue so a broken message is not retried in a loop.
 */
export function finishSend(
  queue: ChatMessageQueue,
  id: string,
  outcome: 'accepted' | 'busy' | 'failed'
): ChatMessageQueue {
  if (queue.sendingId !== id) return queue;
  if (outcome === 'busy') return { ...queue, sendingId: null };
  if (outcome === 'failed') return { ...queue, sendingId: null, paused: 'failed' };
  return { ...queue, sendingId: null, items: queue.items.filter(item => item.id !== id) };
}

// In-memory store, one queue per `${scope}|${threadId}`.

const queues = new Map<string, ChatMessageQueue>();
const listeners = new Map<string, Set<() => void>>();

export function getQueue(key: string): ChatMessageQueue {
  return queues.get(key) ?? EMPTY_QUEUE;
}

export function updateQueue(
  key: string,
  change: (queue: ChatMessageQueue) => ChatMessageQueue
): ChatMessageQueue {
  const current = getQueue(key);
  const next = change(current);
  if (next === current) return current;
  if (next.items.length === 0 && !next.acknowledgedRunId) queues.delete(key);
  else queues.set(key, next);
  for (const listener of listeners.get(key) ?? []) listener();
  return next;
}

/**
 * Atomically claims the head for sending. Returns null when another caller (a
 * re-render, StrictMode's repeated effect, another mounted view) already claimed it.
 */
export function claimNext(key: string, id: string): QueuedChatMessage | null {
  const before = getQueue(key);
  const after = updateQueue(key, queue => beginSend(queue, id));
  return after === before ? null : (after.items[0] ?? null);
}

/** Test helper: forget every queue. */
export function resetQueues(): void {
  queues.clear();
}

export function useChatMessageQueue(key: string): ChatMessageQueue {
  const subscribe = useCallback(
    (listener: () => void) => {
      let set = listeners.get(key);
      if (!set) listeners.set(key, (set = new Set()));
      set.add(listener);
      return () => {
        set.delete(listener);
        if (set.size === 0) listeners.delete(key);
      };
    },
    [key]
  );
  const snapshot = useCallback(() => getQueue(key), [key]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
