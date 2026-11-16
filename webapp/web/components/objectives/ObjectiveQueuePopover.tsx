import type { ObjectiveDto, RunQueueDto } from '@overlord/contract';
import { ListOrdered, Loader2, RotateCcw } from 'lucide-react';
import { type RefObject, useState } from 'react';

import {
  useEnqueueRunQueueEntry,
  useMoveRunQueueEntry,
  useProjectRunQueues,
  useRemoveRunQueueEntry,
  useRetryRunQueueEntry
} from '../../lib/queries.ts';
import { cn } from '../../lib/utils.ts';
import {
  describeQueueEntry,
  QUEUE_STATUS_DETAIL_CLASS,
  type QueueEntryStatus
} from '../run-queue/queue-entry-status.ts';
import { Button } from '../ui.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../ui/dialog.tsx';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover.tsx';

/** Sentinel for "this mission's queue" before that queue has been created. */
const MISSION_QUEUE_OPTION = 'mission-queue';

/** Queue option label; the objective's own mission queue is called out first. */
function queueLabel(queue: RunQueueDto, missionId: string): string {
  if (queue.missionId === missionId) return `${queue.name} (This mission)`;
  return `${queue.name}${queue.isDefault ? ' (Default)' : ''}`;
}

/** "Queued · <status>" plus the status detail, as the trigger's name and tooltip. */
export function queueTriggerTitle(queueStatus: QueueEntryStatus | null): string {
  if (!queueStatus) return 'Add to Run Queue';
  return `Queued · ${queueStatus.label}${queueStatus.detail ? ` — ${queueStatus.detail}` : ''}`;
}

/** Emerald when queued, amber when the queue is holding the entry, grey when not queued. */
export function queueTriggerToneClass(queueStatus: QueueEntryStatus | null): string {
  if (queueStatus?.tone === 'blocked') return 'text-amber-600';
  if (queueStatus) return 'text-emerald-600';
  return 'text-muted-foreground';
}

type ObjectiveQueuePopoverProps = {
  objective: ObjectiveDto;
  /** Controlled open state. Omit both to let the popover manage itself. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /**
   * Render the `ListOrdered` icon trigger. `false` renders no trigger: the popover then opens
   * only through `open` and is positioned at `anchor` (a menu item on a row with no queue icon).
   */
  showTrigger?: boolean;
  /** Extra classes for the trigger (size, hover visibility). Tone comes from the queue status. */
  triggerClassName?: string;
  /** Show a text label beside the icon (the objective detail's run-style button). */
  showLabel?: boolean;
  /** Positioning element when there is no trigger, or to anchor somewhere other than it. */
  anchor?: RefObject<Element | null>;
  align?: 'start' | 'center' | 'end';
};

/**
 * The Run Queue control for one objective: the queued view (status, position, retry, move,
 * remove / force-remove with confirmation) or the add view (predecessor sentence, queue choice,
 * add). Extracted unchanged in content and behaviour from the former draft card's actions so
 * the compact objective row and the objective detail share one popover.
 *
 * Every control inside stops click propagation, so a host row that opens on click never opens
 * because of the popover.
 */
export function ObjectiveQueuePopover({
  objective,
  open: controlledOpen,
  onOpenChange,
  showTrigger = true,
  triggerClassName,
  showLabel = false,
  anchor,
  align = 'end'
}: ObjectiveQueuePopoverProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = (next: boolean) => {
    if (controlledOpen === undefined) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };
  // The queue list is only needed while the popover shows it.
  const queues = useProjectRunQueues(objective.projectId, { enabled: open });
  const enqueue = useEnqueueRunQueueEntry(objective.projectId);
  const dequeue = useRemoveRunQueueEntry(objective.projectId);
  const move = useMoveRunQueueEntry(objective.projectId);
  const retry = useRetryRunQueueEntry(objective.projectId);
  const [removeConfirmOpen, setRemoveConfirmOpen] = useState(false);
  /** True when the pending removal must also unstick an in-flight entry. */
  const [forceRemove, setForceRemove] = useState(false);
  const [selectedQueueId, setSelectedQueueId] = useState<string | null>(null);

  const queueEntry = objective.queueEntry ?? null;
  const queuePending = enqueue.isPending || dequeue.isPending || move.isPending || retry.isPending;
  const allQueues = queues.data?.queues ?? [];
  // The objective's own mission queue is the default destination. When the
  // mission has no queue yet it is offered as MISSION_QUEUE_OPTION and created
  // on the server at enqueue time, so no queue exists until it is used.
  const missionQueue = allQueues.find(queue => queue.missionId === objective.missionId) ?? null;
  const queueOptions = [
    ...(missionQueue ? [missionQueue] : []),
    ...allQueues.filter(queue => queue.id !== missionQueue?.id)
  ];
  const defaultSelection = missionQueue?.id ?? MISSION_QUEUE_OPTION;
  const selection = selectedQueueId ?? queueEntry?.queueId ?? defaultSelection;
  const selectedQueue = allQueues.find(queue => queue.id === selection) ?? null;
  const predecessor = selectedQueue?.entries.at(-1) ?? null;
  const queueStatus = queueEntry ? describeQueueEntry(queueEntry) : null;
  const queueRank = queueEntry
    ? (queues.data?.queues
        .find(queue => queue.id === queueEntry.queueId)
        ?.entries.findIndex(entry => entry.id === queueEntry.id) ?? -1) + 1
    : null;
  const title = queueTriggerTitle(queueStatus);

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        {showTrigger ? (
          <PopoverTrigger
            className={cn(
              'inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs transition-colors hover:bg-accent',
              queueTriggerToneClass(queueStatus),
              triggerClassName
            )}
            aria-label={queueStatus ? `Queued · ${queueStatus.label}` : 'Add to Run Queue'}
            title={title}
            data-queue-pending={queuePending ? 'true' : undefined}
            onClick={event => event.stopPropagation()}
            onPointerDown={event => event.stopPropagation()}
          >
            {queuePending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ListOrdered className="h-3.5 w-3.5" />
            )}
            {showLabel ? (
              <span className="whitespace-nowrap">
                {queueStatus ? `Queued · ${queueStatus.label}` : 'Queue'}
              </span>
            ) : null}
          </PopoverTrigger>
        ) : null}
        <PopoverContent
          className="w-64"
          align={align}
          anchor={anchor}
          onClick={event => event.stopPropagation()}
        >
          {queueEntry ? (
            <div className="flex flex-col gap-2">
              <div>
                <p className="text-sm font-medium">
                  {queueStatus?.label ?? 'Queued'} · {queueEntry.queueName}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {queueRank && queueRank > 0 ? `Position ${queueRank}` : 'Position loading…'}
                </p>
                {queueStatus?.detail ? (
                  <p className={cn('mt-1 text-xs', QUEUE_STATUS_DETAIL_CLASS[queueStatus.tone])}>
                    {queueStatus.detail}
                  </p>
                ) : null}
                {queueStatus?.detailNote ? (
                  <p className="mt-1 text-xs text-muted-foreground">{queueStatus.detailNote}</p>
                ) : null}
              </div>
              {queueStatus?.canRetry ? (
                <Button
                  variant="secondary"
                  className="h-8 text-xs"
                  disabled={queuePending}
                  onClick={() => retry.mutate(queueEntry.id)}
                >
                  <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Retry
                </Button>
              ) : null}
              {retry.isError ? (
                <p role="alert" className="text-xs text-destructive">
                  Could not retry this entry. Check your project permission and retry.
                </p>
              ) : null}
              {queueEntry.state === 'running' || queueEntry.state === 'dispatched' ? (
                <>
                  <p className="text-xs text-muted-foreground">
                    This entry is in flight, so it cannot be reordered. Force-remove it if the
                    launch never started and the objective is stuck.
                  </p>
                  <Button
                    variant="danger"
                    className="h-8 text-xs"
                    onClick={() => {
                      setForceRemove(true);
                      setRemoveConfirmOpen(true);
                    }}
                  >
                    Force-remove from queue
                  </Button>
                </>
              ) : (
                <>
                  <label className="space-y-1 text-xs text-muted-foreground">
                    <span>Queue</span>
                    <select
                      className="h-8 w-full rounded-md border bg-background px-2 text-xs text-foreground"
                      value={selection}
                      onChange={event => {
                        const queueId = event.target.value;
                        setSelectedQueueId(queueId);
                        if (queueId !== queueEntry.queueId && queueId !== MISSION_QUEUE_OPTION)
                          move.mutate({ entryId: queueEntry.id, queueId });
                      }}
                    >
                      {queueOptions.map(queue => (
                        <option key={queue.id} value={queue.id}>
                          {queueLabel(queue, objective.missionId)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <Button
                    variant="secondary"
                    className="h-8 text-xs"
                    onClick={() => {
                      setForceRemove(false);
                      setRemoveConfirmOpen(true);
                    }}
                  >
                    Remove from queue
                  </Button>
                </>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <div>
                <p className="text-sm font-medium">Add to Run Queue</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {predecessor
                    ? `It will follow ${predecessor.objectiveTitle ?? predecessor.objectiveDisplayId} · ${predecessor.missionTitle}.`
                    : `This will be the first entry in ${selectedQueue?.name ?? "this mission's new queue"}.`}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Every objective after this one in the mission is queued with it.
                </p>
              </div>
              <label className="space-y-1 text-xs text-muted-foreground">
                <span>Queue</span>
                <select
                  className="h-8 w-full rounded-md border bg-background px-2 text-xs text-foreground"
                  value={selection}
                  onChange={event => setSelectedQueueId(event.target.value)}
                >
                  {!missionQueue ? (
                    <option value={MISSION_QUEUE_OPTION}>This mission&apos;s queue (new)</option>
                  ) : null}
                  {queueOptions.map(queue => (
                    <option key={queue.id} value={queue.id}>
                      {queueLabel(queue, objective.missionId)}
                    </option>
                  ))}
                </select>
              </label>
              <Button
                className="h-8 text-xs"
                disabled={queues.isLoading || queuePending}
                onClick={() =>
                  enqueue.mutate({
                    objectiveId: objective.id,
                    // Omitting queueId asks the server for this objective's
                    // mission queue, creating it only if it is missing.
                    ...(selection === MISSION_QUEUE_OPTION ? {} : { queueId: selection })
                  })
                }
              >
                Add to queue
              </Button>
              {enqueue.isError ? (
                <p role="alert" className="text-xs text-destructive">
                  Could not add to queue.
                </p>
              ) : null}
            </div>
          )}
        </PopoverContent>
      </Popover>
      <Dialog open={removeConfirmOpen} onOpenChange={setRemoveConfirmOpen}>
        <DialogContent onClick={event => event.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>
              {forceRemove ? 'Force-remove from Run Queue?' : 'Remove from Run Queue?'}
            </DialogTitle>
            <DialogDescription>
              {forceRemove
                ? 'This drops the in-flight entry, clears the execution requests it left behind, and returns an objective still stuck in Launching to Draft so it can be run again. An objective already Executing keeps its live session.'
                : 'This objective will no longer wait for the queue and will not be launched automatically. It moves to the end of the mission’s objectives.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setRemoveConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={!queueEntry || dequeue.isPending}
              onClick={() => {
                if (!queueEntry) return;
                dequeue.mutate(
                  { entryId: queueEntry.id, force: forceRemove },
                  { onSuccess: () => setRemoveConfirmOpen(false) }
                );
              }}
            >
              {forceRemove ? 'Force-remove' : 'Remove'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
