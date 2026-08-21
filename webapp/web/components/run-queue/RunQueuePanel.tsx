import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Link } from '@tanstack/react-router';
import {
  ArrowDown,
  ArrowUp,
  GripVertical,
  Loader2,
  OctagonX,
  Pause,
  Pencil,
  Play,
  Plus,
  Radio,
  Rows3,
  Trash2,
  X
} from 'lucide-react';
import { useEffect, useState } from 'react';

import type { RunQueueDto, RunQueueEntryDto } from '../../../shared/contract.ts';
import {
  useCreateRunQueue,
  useDeleteRunQueue,
  useMoveRunQueueEntry,
  useProjectRunQueues,
  useRemoveRunQueueEntry,
  useReorderProjectRunQueues,
  useReorderRunQueue,
  useUpdateRunQueue
} from '../../lib/queries.ts';
import { cn } from '../../lib/utils.ts';
import { Button, EmptyState, Spinner } from '../ui.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../ui/dialog.tsx';
import { Input } from '../ui/input.tsx';
import { Switch } from '../ui/switch.tsx';

/** Dispatched/running entries need the forced path to leave a queue. */
const isEntryInFlight = (entry: RunQueueEntryDto) =>
  entry.state === 'running' || entry.state === 'dispatched';

type PendingEntryMove = {
  entry: RunQueueEntryDto;
  destination: RunQueueDto;
  afterEntryId?: string;
};

function QueueRow({
  entry,
  projectId,
  onRemove
}: {
  entry: RunQueueEntryDto;
  projectId: string;
  onRemove: (entry: RunQueueEntryDto) => void;
}) {
  const locked = entry.state === 'running' || entry.state === 'dispatched';
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: entry.id,
    disabled: locked
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'flex min-w-0 items-center gap-2 rounded-md border border-border/60 bg-background px-2 py-2',
        isDragging && 'z-10 opacity-70',
        locked && 'bg-muted/35'
      )}
    >
      <button
        type="button"
        aria-label={locked ? 'Running queue entries cannot move' : 'Move queue entry'}
        className={cn(
          'inline-flex h-6 w-5 shrink-0 items-center justify-center rounded text-muted-foreground/50',
          locked
            ? 'cursor-not-allowed'
            : 'cursor-grab hover:text-muted-foreground active:cursor-grabbing'
        )}
        disabled={locked}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      {locked ? (
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-sky-500" />
      ) : (
        <Rows3 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      )}
      <div className="min-w-0 flex-1">
        <Link
          to="/projects/$projectId/missions/$missionId"
          params={{ projectId, missionId: entry.missionId }}
          className="block truncate text-sm font-medium hover:underline"
        >
          {entry.objectiveTitle ?? entry.objectiveDisplayId}
        </Link>
        <p className="truncate text-[11px] text-muted-foreground">
          {entry.missionTitle} · {entry.objectiveDisplayId}
          {entry.resourceKey ? ` · ${entry.resourceKey}` : ''}
        </p>
        {entry.blockedReason ? (
          <p className="mt-0.5 text-[11px] text-amber-700 dark:text-amber-400">
            Held: {entry.blockedReason}
          </p>
        ) : null}
      </div>
      <span
        className={cn(
          'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium',
          locked
            ? 'bg-sky-500/15 text-sky-700 dark:text-sky-300'
            : entry.state === 'blocked'
              ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
              : 'bg-muted text-muted-foreground'
        )}
      >
        {entry.state === 'dispatched' ? 'In flight' : entry.state}
      </span>
      <Button
        variant="ghost"
        className="h-7 w-7 shrink-0 p-0 text-destructive hover:text-destructive"
        title={
          locked
            ? 'Force-remove this in-flight entry so the objective can launch again'
            : 'Remove from queue'
        }
        aria-label={locked ? 'Force-remove queue entry' : 'Remove queue entry'}
        onClick={() => onRemove(entry)}
      >
        {locked ? <OctagonX className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
      </Button>
    </div>
  );
}

function QueueDropZone({ queue }: { queue: RunQueueDto }) {
  const { setNodeRef, isOver } = useDroppable({ id: `queue-drop-${queue.id}` });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'rounded-md border border-dashed px-3 py-4 text-center text-xs text-muted-foreground transition-colors',
        isOver && 'border-primary bg-primary/5 text-foreground'
      )}
    >
      {queue.entries.length === 0 ? 'Drop an objective here.' : 'Drop here to move to the end.'}
    </div>
  );
}

function QueueSection({
  projectId,
  queue,
  queueIndex,
  queueCount,
  onRename,
  onDelete,
  onMoveQueue,
  onRemoveEntry
}: {
  projectId: string;
  queue: RunQueueDto;
  queueIndex: number;
  queueCount: number;
  onRename: (queue: RunQueueDto) => void;
  onDelete: (queue: RunQueueDto) => void;
  onMoveQueue: (queue: RunQueueDto, direction: -1 | 1) => void;
  onRemoveEntry: (entry: RunQueueEntryDto) => void;
}) {
  const update = useUpdateRunQueue(projectId);
  return (
    <section className="rounded-lg border border-border bg-muted/15 p-3">
      <div className="mb-3 flex items-center gap-2">
        <Radio
          className={cn('h-4 w-4', queue.paused ? 'text-muted-foreground' : 'text-emerald-600')}
        />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold">
            {queue.name}
            {queue.isDefault ? ' · Default' : queue.missionId ? ' · Mission' : ''}
          </h2>
          <p className="text-[11px] text-muted-foreground">
            {queue.running
              ? `Running ${queue.running.objectiveDisplayId}`
              : queue.paused
                ? 'Paused'
                : 'Ready'}
            {' · '}
            {queue.entries.length} {queue.entries.length === 1 ? 'entry' : 'entries'}
          </p>
        </div>
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            className="h-7 w-7 p-0"
            title="Move queue earlier"
            disabled={queue.isDefault || queueIndex <= 1}
            onClick={() => onMoveQueue(queue, -1)}
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            className="h-7 w-7 p-0"
            title="Move queue later"
            disabled={queue.isDefault || queueIndex === queueCount - 1}
            onClick={() => onMoveQueue(queue, 1)}
          >
            <ArrowDown className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            className="h-7 w-7 p-0"
            title="Rename queue"
            onClick={() => onRename(queue)}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          {!queue.isDefault ? (
            <Button
              variant="ghost"
              className="h-7 w-7 p-0 text-destructive hover:text-destructive"
              title="Delete queue"
              onClick={() => onDelete(queue)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          ) : null}
        </div>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {queue.paused ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          <span>{queue.paused ? 'Paused' : 'Active'}</span>
          <Switch
            checked={!queue.paused}
            disabled={update.isPending}
            onCheckedChange={active =>
              update.mutate({ queueId: queue.id, body: { paused: !active } })
            }
          />
        </label>
      </div>
      <SortableContext
        items={queue.entries.map(entry => entry.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="space-y-1.5">
          {queue.entries.map(entry => (
            <QueueRow key={entry.id} entry={entry} projectId={projectId} onRemove={onRemoveEntry} />
          ))}
          <QueueDropZone queue={queue} />
        </div>
      </SortableContext>
    </section>
  );
}

/** Shared project queue view for the route and compact board-header sheet. */
export function RunQueuePanel({
  projectId,
  compact = false
}: {
  projectId: string;
  compact?: boolean;
}) {
  const queues = useProjectRunQueues(projectId);
  const reorderEntries = useReorderRunQueue(projectId);
  const reorderQueues = useReorderProjectRunQueues(projectId);
  const moveEntry = useMoveRunQueueEntry(projectId);
  const createQueue = useCreateRunQueue(projectId);
  const deleteQueue = useDeleteRunQueue(projectId);
  const updateQueue = useUpdateRunQueue(projectId);
  const removeEntry = useRemoveRunQueueEntry(projectId);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const [queueName, setQueueName] = useState('');
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<RunQueueDto | null>(null);
  const [deleting, setDeleting] = useState<RunQueueDto | null>(null);
  const [moveEntriesTo, setMoveEntriesTo] = useState('');
  const [pendingMove, setPendingMove] = useState<PendingEntryMove | null>(null);
  const [removingEntry, setRemovingEntry] = useState<RunQueueEntryDto | null>(null);

  useEffect(() => {
    if (deleting && !moveEntriesTo)
      setMoveEntriesTo(
        (
          queues.data?.queues.find(queue => queue.isDefault && queue.id !== deleting.id) ??
          queues.data?.queues.find(queue => queue.id !== deleting.id)
        )?.id ?? ''
      );
  }, [deleting, moveEntriesTo, queues.data?.queues]);

  if (queues.isLoading)
    return (
      <div className="p-4">
        <Spinner />
      </div>
    );
  if (queues.isError)
    return (
      <p className="p-4 text-sm text-destructive">
        Could not load Run Queues. Check access and retry.
      </p>
    );
  if (!queues.data?.queues.length)
    return (
      <EmptyState
        title="No Run Queues"
        hint="Create a queue here, or queue an objective from its mission — that creates the mission's queue on first use."
      />
    );
  const queueList = queues.data.queues;

  function reorderQueueDefinition(queue: RunQueueDto, direction: -1 | 1) {
    const from = queueList.findIndex(item => item.id === queue.id);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= queueList.length) return;
    reorderQueues.mutate(arrayMove(queueList, from, to).map(item => item.id));
  }

  function handleDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const sourceQueue = queueList.find(queue =>
      queue.entries.some(entry => entry.id === active.id)
    );
    const entry = sourceQueue?.entries.find(item => item.id === active.id);
    if (!sourceQueue || !entry || entry.state === 'running' || entry.state === 'dispatched') return;
    const overId = String(over.id);
    const targetEntry = queueList.flatMap(queue => queue.entries).find(item => item.id === over.id);
    const destination = targetEntry
      ? queueList.find(queue => queue.id === targetEntry.queueId)
      : overId.startsWith('queue-drop-')
        ? queueList.find(queue => queue.id === overId.slice('queue-drop-'.length))
        : undefined;
    if (!destination) return;
    if (destination.id === sourceQueue.id) {
      const from = sourceQueue.entries.findIndex(item => item.id === entry.id);
      const to = targetEntry
        ? sourceQueue.entries.findIndex(item => item.id === over.id)
        : sourceQueue.entries.length - 1;
      if (from < 0 || to < 0) return;
      reorderEntries.mutate({
        queueId: sourceQueue.id,
        orderedEntryIds: arrayMove(sourceQueue.entries, from, to).map(item => item.id)
      });
      return;
    }
    setPendingMove({ entry, destination, afterEntryId: targetEntry?.id });
  }

  return (
    <div className={cn('space-y-3', compact ? 'p-1' : 'mx-auto w-full max-w-3xl p-6')}>
      {!compact ? (
        <header className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">Run Queue</h1>
            <p className="text-sm text-muted-foreground">
              Objectives launch in order within each queue. Direct Run stays independent.
            </p>
          </div>
          <Button
            className="h-8 shrink-0 px-3 text-xs"
            onClick={() => {
              setQueueName('');
              setCreating(true);
            }}
          >
            <Plus className="mr-1.5 h-4 w-4" /> New queue
          </Button>
        </header>
      ) : (
        <Button
          className="h-8 w-full text-xs"
          variant="secondary"
          onClick={() => {
            setQueueName('');
            setCreating(true);
          }}
        >
          <Plus className="mr-1.5 h-4 w-4" /> New queue
        </Button>
      )}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        {queueList.map((queue, index) => (
          <QueueSection
            key={queue.id}
            projectId={projectId}
            queue={queue}
            queueIndex={index}
            queueCount={queueList.length}
            onRename={queue => {
              setQueueName(queue.name);
              setRenaming(queue);
            }}
            onDelete={queue => {
              setMoveEntriesTo(
                (
                  queueList.find(item => item.isDefault && item.id !== queue.id) ??
                  queueList.find(item => item.id !== queue.id)
                )?.id ?? ''
              );
              setDeleting(queue);
            }}
            onMoveQueue={reorderQueueDefinition}
            onRemoveEntry={setRemovingEntry}
          />
        ))}
      </DndContext>
      {reorderQueues.isError ? (
        <p role="alert" className="text-xs text-destructive">
          Could not reorder queues. The previous order was restored.
        </p>
      ) : null}
      {reorderEntries.isError || moveEntry.isError ? (
        <p role="alert" className="text-xs text-destructive">
          Could not move this entry. The previous order was restored.
        </p>
      ) : null}
      {removeEntry.isError ? (
        <p role="alert" className="text-xs text-destructive">
          Could not remove this entry. Check your project permission and retry.
        </p>
      ) : null}
      {createQueue.isError || updateQueue.isError || deleteQueue.isError ? (
        <p role="alert" className="text-xs text-destructive">
          Could not update this queue. Check your project permission and retry.
        </p>
      ) : null}
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Run Queue</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            value={queueName}
            onChange={event => setQueueName(event.target.value)}
            placeholder="Queue name"
          />
          <DialogFooter>
            <Button variant="secondary" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button
              disabled={!queueName.trim() || createQueue.isPending}
              onClick={() =>
                createQueue.mutate(queueName, {
                  onSuccess: () => {
                    setQueueName('');
                    setCreating(false);
                  }
                })
              }
            >
              Create queue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(renaming)} onOpenChange={open => !open && setRenaming(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename Run Queue</DialogTitle>
          </DialogHeader>
          <Input autoFocus value={queueName} onChange={event => setQueueName(event.target.value)} />
          <DialogFooter>
            <Button variant="secondary" onClick={() => setRenaming(null)}>
              Cancel
            </Button>
            <Button
              disabled={!renaming || !queueName.trim() || updateQueue.isPending}
              onClick={() =>
                renaming &&
                updateQueue.mutate(
                  { queueId: renaming.id, body: { name: queueName } },
                  { onSuccess: () => setRenaming(null) }
                )
              }
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(deleting)} onOpenChange={open => !open && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {deleting?.name}?</DialogTitle>
            <DialogDescription>
              {deleting?.entries.length
                ? 'Move every queued objective to another queue before deletion.'
                : 'This empty queue will be removed.'}
            </DialogDescription>
          </DialogHeader>
          {deleting?.entries.length ? (
            <select
              className="h-9 rounded-md border bg-background px-3 text-sm"
              value={moveEntriesTo}
              onChange={event => setMoveEntriesTo(event.target.value)}
            >
              {queueList
                .filter(queue => queue.id !== deleting.id)
                .map(queue => (
                  <option key={queue.id} value={queue.id}>
                    {queue.name}
                    {queue.isDefault ? ' (Default)' : ''}
                  </option>
                ))}
            </select>
          ) : null}
          <DialogFooter>
            <Button variant="secondary" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={
                !deleting ||
                (Boolean(deleting.entries.length) && !moveEntriesTo) ||
                deleteQueue.isPending
              }
              onClick={() =>
                deleting &&
                deleteQueue.mutate(
                  { queueId: deleting.id, ...(deleting.entries.length ? { moveEntriesTo } : {}) },
                  { onSuccess: () => setDeleting(null) }
                )
              }
            >
              Delete queue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(removingEntry)} onOpenChange={open => !open && setRemovingEntry(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {removingEntry && isEntryInFlight(removingEntry)
                ? 'Force-remove this in-flight entry?'
                : 'Remove from this queue?'}
            </DialogTitle>
            <DialogDescription>
              {removingEntry && isEntryInFlight(removingEntry)
                ? 'This drops the entry, clears the execution requests it left behind, and returns an objective still stuck in Launching to Draft so it can be run again. An objective already Executing keeps its live session.'
                : 'The objective leaves this queue and will not be launched automatically.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setRemovingEntry(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={!removingEntry || removeEntry.isPending}
              onClick={() =>
                removingEntry &&
                removeEntry.mutate(
                  { entryId: removingEntry.id, force: isEntryInFlight(removingEntry) },
                  { onSuccess: () => setRemovingEntry(null) }
                )
              }
            >
              {removingEntry && isEntryInFlight(removingEntry) ? 'Force-remove' : 'Remove'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(pendingMove)} onOpenChange={open => !open && setPendingMove(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move to {pendingMove?.destination.name}?</DialogTitle>
            <DialogDescription>
              This changes the sequence that launches this objective. Its mission order will update
              with the queue.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setPendingMove(null)}>
              Cancel
            </Button>
            <Button
              disabled={!pendingMove || moveEntry.isPending}
              onClick={() =>
                pendingMove &&
                moveEntry.mutate(
                  {
                    entryId: pendingMove.entry.id,
                    queueId: pendingMove.destination.id,
                    ...(pendingMove.afterEntryId ? { afterEntryId: pendingMove.afterEntryId } : {})
                  },
                  { onSuccess: () => setPendingMove(null) }
                )
              }
            >
              Move objective
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
