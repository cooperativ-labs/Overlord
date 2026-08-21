import { Check, Copy, ListOrdered, Loader2, MoreVertical, Trash2 } from 'lucide-react';
import { useState } from 'react';

import type { ObjectiveDto, ObjectiveState, RunQueueDto } from '../../../shared/contract.ts';
import { useCopyToClipboard } from '../../lib/hooks/use-copy-to-clipboard.ts';
import {
  useDeleteObjective,
  useEnqueueRunQueueEntry,
  useMoveRunQueueEntry,
  useProjectRunQueues,
  useRemoveRunQueueEntry,
  useUpdateObjective
} from '../../lib/queries.ts';
import { cn } from '../../lib/utils.ts';
import { OBJECTIVE_STATE_LABEL } from '../ui.tsx';
import { Button } from '../ui.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../ui/dialog.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '../ui/dropdown-menu.tsx';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover.tsx';

const AUTO_ADVANCE_TOGGLE_STATES: ObjectiveState[] = ['future', 'draft', 'submitted', 'launching'];
/** Sentinel for "this mission's queue" before that queue has been created. */
const MISSION_QUEUE_OPTION = 'mission-queue';
const OBJECTIVE_STATES: ObjectiveState[] = [
  'future',
  'draft',
  'submitted',
  'launching',
  'executing',
  'pending_delivery',
  'complete'
];

type DraftObjectiveActionsProps = {
  objective: ObjectiveDto;
};

/** Queue option label; the objective's own mission queue is called out first. */
function queueLabel(queue: RunQueueDto, missionId: string): string {
  if (queue.missionId === missionId) return `${queue.name} (This mission)`;
  return `${queue.name}${queue.isDefault ? ' (Default)' : ''}`;
}

/** State picker, delete, and Run Queue controls for a draft objective card. */
export function DraftObjectiveActions({ objective }: DraftObjectiveActionsProps) {
  const update = useUpdateObjective();
  const remove = useDeleteObjective();
  const queues = useProjectRunQueues(objective.projectId);
  const enqueue = useEnqueueRunQueueEntry(objective.projectId);
  const dequeue = useRemoveRunQueueEntry(objective.projectId);
  const move = useMoveRunQueueEntry(objective.projectId);
  const { copied, copy } = useCopyToClipboard();
  const [removeConfirmOpen, setRemoveConfirmOpen] = useState(false);
  /** True when the pending removal must also unstick an in-flight entry. */
  const [forceRemove, setForceRemove] = useState(false);
  const [selectedQueueId, setSelectedQueueId] = useState<string | null>(null);

  const canToggleAutoAdvance = AUTO_ADVANCE_TOGGLE_STATES.includes(objective.state);
  const queueEntry = objective.queueEntry ?? null;
  const queuePending = enqueue.isPending || dequeue.isPending || move.isPending;
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
  const queueRank = queueEntry
    ? (queues.data?.queues
        .find(queue => queue.id === queueEntry.queueId)
        ?.entries.findIndex(entry => entry.id === queueEntry.id) ?? -1) + 1
    : null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50"
          aria-label="Objective actions"
          title="Objective actions"
        >
          <MoreVertical className="h-3.5 w-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[160px]">
          {OBJECTIVE_STATES.map(s => (
            <DropdownMenuItem
              key={s}
              className="gap-2 text-xs"
              onClick={() => update.mutate({ id: objective.id, body: { state: s } })}
            >
              <span>{OBJECTIVE_STATE_LABEL[s]}</span>
              {s === objective.state && <Check className="ml-auto h-3 w-3 text-muted-foreground" />}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          {objective.displayId ? (
            <DropdownMenuItem
              className="gap-2 text-xs"
              onClick={() => {
                void copy(objective.displayId);
              }}
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-green-600" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              <span>Copy {objective.displayId}</span>
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            className="gap-2 text-xs text-red-600 focus:text-red-600"
            onClick={() => {
              if (confirm('Delete this objective?')) remove.mutate(objective.id);
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>Delete objective</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {canToggleAutoAdvance ? (
        <Popover>
          <PopoverTrigger
            className={cn(
              'inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs transition-colors hover:bg-accent',
              queueEntry ? 'text-emerald-600' : 'text-muted-foreground'
            )}
            aria-label={queueEntry ? 'Queued' : 'Add to Run Queue'}
            title={queueEntry ? 'Queued' : 'Add to Run Queue'}
          >
            {queuePending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ListOrdered className="h-3.5 w-3.5" />
            )}
          </PopoverTrigger>
          <PopoverContent className="w-64" align="end">
            {queueEntry ? (
              <div className="flex flex-col gap-2">
                <div>
                  <p className="text-sm font-medium">Queued · {queueEntry.queueName}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {queueRank && queueRank > 0 ? `Position ${queueRank}` : 'Position loading…'}
                  </p>
                  {queueEntry.precededBy ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      After{' '}
                      {queueEntry.precededBy.objectiveTitle ??
                        queueEntry.precededBy.objectiveDisplayId}
                      {' · '}
                      {queueEntry.precededBy.missionTitle}
                    </p>
                  ) : null}
                  {queueEntry.blockedReason ? (
                    <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                      Held: {queueEntry.blockedReason}
                    </p>
                  ) : null}
                </div>
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
              </div>
            )}
          </PopoverContent>
        </Popover>
      ) : null}
      <Dialog open={removeConfirmOpen} onOpenChange={setRemoveConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {forceRemove ? 'Force-remove from Run Queue?' : 'Remove from Run Queue?'}
            </DialogTitle>
            <DialogDescription>
              {forceRemove
                ? 'This drops the in-flight entry, clears the execution requests it left behind, and returns an objective still stuck in Launching to Draft so it can be run again. An objective already Executing keeps its live session.'
                : 'This objective will no longer wait for the queue. It will not be launched automatically.'}
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
