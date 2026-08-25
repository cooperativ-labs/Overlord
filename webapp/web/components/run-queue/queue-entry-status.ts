import type { RunQueueEntryState, RunQueueWaitingReason } from '../../../shared/contract.ts';

/** Mirrors the planner's ceiling in `automations/src/objective-manager/rules.ts`. */
export const MAX_DISPATCH_ATTEMPTS = 3;

/** The subset of a queue entry that decides how its hold reads. */
export interface QueueEntryStatusInput {
  state: RunQueueEntryState;
  blockedReason: string | null;
  waitingReason?: RunQueueWaitingReason | null;
  waitingOnObjectiveDisplayId?: string | null;
  attemptCount?: number | null;
}

export interface QueueEntryStatus {
  /** Pill text. */
  label: string;
  /**
   * `waiting` is neutral on purpose: the condition clears on its own. Only
   * `blocked` — something a human must fix — is amber.
   */
  tone: 'in_flight' | 'neutral' | 'blocked';
  /** Secondary line: what it is waiting for, or the action a human must take. */
  detail: string | null;
  /** Sanitized failure text preserved from the attempt that failed, if any. */
  detailNote: string | null;
  /** Sibling this entry is queued behind; the detail line links to it. */
  waitingOnObjectiveDisplayId: string | null;
  /** True when Retry can clear this hold. */
  canRetry: boolean;
}

/** Splits `dispatch_failed: boom` into its kind and its detail. */
function splitBlockedReason(reason: string | null): { kind: string; detail: string | null } {
  if (!reason) return { kind: '', detail: null };
  const separator = reason.indexOf(':');
  if (separator < 0) return { kind: reason.trim(), detail: null };
  return {
    kind: reason.slice(0, separator).trim(),
    detail: reason.slice(separator + 1).trim() || null
  };
}

/**
 * One vocabulary for every Run Queue surface.
 *
 * A `waiting` entry is not in trouble — it is queued behind a sibling, a
 * disconnected resource, or its own next attempt — so it never renders amber
 * and its copy names the thing it is waiting for. `blocked` means the
 * dispatcher has given up until a human acts, so its copy is that action.
 */
export function describeQueueEntry(entry: QueueEntryStatusInput): QueueEntryStatus {
  const base: QueueEntryStatus = {
    label: 'Waiting',
    tone: 'neutral',
    detail: null,
    detailNote: null,
    waitingOnObjectiveDisplayId: null,
    canRetry: false
  };
  if (entry.state === 'running') return { ...base, label: 'Running', tone: 'in_flight' };
  if (entry.state === 'dispatched') return { ...base, label: 'In flight', tone: 'in_flight' };

  if (entry.state === 'waiting') {
    const { detail } = splitBlockedReason(entry.blockedReason);
    if (entry.waitingReason === 'mission_busy')
      return {
        ...base,
        waitingOnObjectiveDisplayId: entry.waitingOnObjectiveDisplayId ?? null,
        detail: entry.waitingOnObjectiveDisplayId
          ? `Waiting for ${entry.waitingOnObjectiveDisplayId} to finish`
          : 'Waiting for another objective in this mission to finish'
      };
    if (entry.waitingReason === 'resource_disconnected')
      return { ...base, detail: 'Waiting for its resource to reconnect' };
    if (entry.waitingReason === 'retry_pending') {
      const attempt = Math.min((entry.attemptCount ?? 0) + 1, MAX_DISPATCH_ATTEMPTS);
      return {
        ...base,
        label: 'Retrying',
        detail: `Retrying (${attempt}/${MAX_DISPATCH_ATTEMPTS})`,
        detailNote: detail
      };
    }
    return base;
  }

  const { kind, detail } = splitBlockedReason(entry.blockedReason);
  if (kind === 'no_agent')
    return { ...base, label: 'Blocked', tone: 'blocked', detail: 'Assign an agent' };
  if (kind === 'no_instruction')
    return { ...base, label: 'Blocked', tone: 'blocked', detail: 'Add instructions' };
  if (kind === 'dispatch_failed' || kind === 'request_failed')
    return {
      ...base,
      label: 'Blocked',
      tone: 'blocked',
      detail: `Launch failed ${MAX_DISPATCH_ATTEMPTS}× — Retry`,
      detailNote: detail,
      canRetry: true
    };
  return {
    ...base,
    label: 'Blocked',
    tone: 'blocked',
    detail: entry.blockedReason?.replaceAll('_', ' ') ?? null
  };
}

/** Tailwind classes for the status pill, keyed by tone. */
export const QUEUE_STATUS_PILL_CLASS: Record<QueueEntryStatus['tone'], string> = {
  in_flight: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  neutral: 'bg-muted text-muted-foreground',
  blocked: 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
};

/** Tailwind classes for the secondary detail line, keyed by tone. */
export const QUEUE_STATUS_DETAIL_CLASS: Record<QueueEntryStatus['tone'], string> = {
  in_flight: 'text-muted-foreground',
  neutral: 'text-muted-foreground',
  blocked: 'text-amber-700 dark:text-amber-400'
};
