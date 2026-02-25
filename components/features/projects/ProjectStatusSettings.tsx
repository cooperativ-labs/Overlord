'use client';

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Check, ChevronDown, GripVertical, Pencil, Trash2, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import type { ButtonLoadingState } from '@/components/ui/loading-button';
import { LoadingButton } from '@/components/ui/loading-button';
import {
  createTicketStatusAction,
  deleteTicketStatusAction,
  reorderTicketStatusesAction,
  updateTicketStatusNameAction
} from '@/lib/actions/ticket-statuses';
import { cn } from '@/lib/utils';
import type { Database } from '@/types/database.types';

type TicketStatusType = Database['public']['Enums']['ticket_status_type'];

const statusTypeOptions: Array<{ value: TicketStatusType; label: string }> = [
  { value: 'draft', label: 'Draft' },
  { value: 'execute', label: 'Execute' },
  { value: 'review', label: 'Review' },
  { value: 'complete', label: 'Complete' }
];

type StatusRow = {
  name: string;
  position: number;
  statusType: TicketStatusType;
  isDefault: boolean;
};

type ProjectStatusSettingsProps = {
  organizationId: number;
  projectId: string;
  initialStatuses: StatusRow[];
  defaultExpanded?: boolean;
};

export function ProjectStatusSettings({
  organizationId,
  projectId,
  initialStatuses,
  defaultExpanded = false
}: ProjectStatusSettingsProps) {
  const router = useRouter();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const [statuses, setStatuses] = useState<StatusRow[]>(initialStatuses);
  const [statusesOpen, setStatusesOpen] = useState(defaultExpanded);
  const [statusName, setStatusName] = useState('');
  const [statusType, setStatusType] = useState<TicketStatusType>('execute');
  const [addButtonState, setAddButtonState] = useState<ButtonLoadingState>('default');
  const [pendingDeleteName, setPendingDeleteName] = useState<string | null>(null);
  const [pendingReorder, setPendingReorder] = useState(false);
  const [pendingRenameName, setPendingRenameName] = useState<string | null>(null);
  const [editingStatusName, setEditingStatusName] = useState<string | null>(null);
  const [editingNameValue, setEditingNameValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setStatuses(initialStatuses);
  }, [initialStatuses]);

  async function handleAddStatus() {
    setAddButtonState('loading');
    setError(null);

    try {
      const created = await createTicketStatusAction({
        organizationId,
        projectId,
        name: statusName,
        statusType
      });

      setStatuses(prev =>
        [...prev, created].sort((left, right) => {
          if (left.position === right.position) return left.name.localeCompare(right.name);
          return left.position - right.position;
        })
      );
      setStatusName('');
      setStatusType('execute');
      setAddButtonState('success');
      router.refresh();
    } catch (cause) {
      setAddButtonState('error');
      setError(cause instanceof Error ? cause.message : 'Failed to add status.');
    }
  }

  async function handleDeleteStatus(name: string) {
    setPendingDeleteName(name);
    setError(null);

    try {
      await deleteTicketStatusAction({
        organizationId,
        projectId,
        name
      });
      setStatuses(prev => prev.filter(status => status.name !== name));
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to delete status.');
    } finally {
      setPendingDeleteName(null);
    }
  }

  async function handleStatusDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      return;
    }

    const previousStatuses = statuses;
    const oldIndex = previousStatuses.findIndex(status => status.name === active.id);
    const newIndex = previousStatuses.findIndex(status => status.name === over.id);

    if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) {
      return;
    }

    const nextStatuses = arrayMove(previousStatuses, oldIndex, newIndex).map(
      (status, position) => ({
        ...status,
        position
      })
    );

    setStatuses(nextStatuses);
    setPendingReorder(true);
    setError(null);

    try {
      const reordered = await reorderTicketStatusesAction({
        organizationId,
        projectId,
        orderedNames: nextStatuses.map(status => status.name)
      });
      setStatuses(reordered);
      router.refresh();
    } catch (cause) {
      setStatuses(previousStatuses);
      setError(cause instanceof Error ? cause.message : 'Failed to reorder statuses.');
    } finally {
      setPendingReorder(false);
    }
  }

  function handleStartRename(name: string) {
    setEditingStatusName(name);
    setEditingNameValue(name);
    setError(null);
  }

  function handleCancelRename() {
    setEditingStatusName(null);
    setEditingNameValue('');
  }

  async function handleSaveRename(currentName: string) {
    setPendingRenameName(currentName);
    setError(null);

    try {
      const updated = await updateTicketStatusNameAction({
        organizationId,
        projectId,
        currentName,
        nextName: editingNameValue
      });

      if (updated) {
        setStatuses(prev => prev.map(status => (status.name === currentName ? updated : status)));
      }
      handleCancelRename();
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to update status name.');
    } finally {
      setPendingRenameName(null);
    }
  }

  const hasPendingMutation =
    addButtonState === 'loading' ||
    pendingDeleteName !== null ||
    pendingReorder ||
    pendingRenameName !== null;

  return (
    <div className="mt-5 md:max-w-2xl">
      <Collapsible open={statusesOpen} onOpenChange={setStatusesOpen} className="rounded-md border">
        <div className="flex items-center justify-between gap-3 px-3 py-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Task Statuses
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {statuses.length} statuses define board columns across this organization.
            </p>
          </div>
          <CollapsibleTrigger asChild>
            <Button type="button" size="sm" variant="ghost" className="h-8 gap-1.5">
              {statusesOpen ? 'Hide' : 'Show'}
              <ChevronDown
                className={cn('h-4 w-4 transition-transform', statusesOpen ? 'rotate-180' : '')}
              />
            </Button>
          </CollapsibleTrigger>
        </div>

        <CollapsibleContent className="border-t px-3 py-3">
          <div className="grid gap-3">
            <div className="grid gap-2 rounded-md border p-3">
              {statuses.length > 0 ? (
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleStatusDragEnd}
                >
                  <SortableContext
                    items={statuses.map(status => status.name)}
                    strategy={verticalListSortingStrategy}
                  >
                    {statuses.map(status => (
                      <SortableStatusRow
                        key={status.name}
                        status={status}
                        editingStatusName={editingStatusName}
                        editingNameValue={editingNameValue}
                        hasPendingMutation={hasPendingMutation}
                        onDeleteStatus={handleDeleteStatus}
                        onStartRename={handleStartRename}
                        onSaveRename={handleSaveRename}
                        onCancelRename={handleCancelRename}
                        setEditingNameValue={setEditingNameValue}
                      />
                    ))}
                  </SortableContext>
                </DndContext>
              ) : (
                <p className="text-xs text-muted-foreground">
                  No statuses found for this organization.
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={statusName}
                onChange={event => setStatusName(event.target.value)}
                placeholder="e.g. qa-ready"
                className="h-8 min-w-[220px] flex-1"
                disabled={addButtonState === 'loading'}
                aria-label="New status name"
              />
              <select
                className="h-8 min-w-[150px] cursor-pointer rounded-md border bg-transparent px-2 text-sm"
                value={statusType}
                onChange={event => setStatusType(event.target.value as TicketStatusType)}
                disabled={addButtonState === 'loading'}
                aria-label="Status type"
              >
                {statusTypeOptions.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <LoadingButton
                buttonState={addButtonState}
                setButtonState={setAddButtonState}
                text="Add status"
                loadingText="Adding…"
                successText="Added"
                errorText="Retry"
                reset
                size="sm"
                variant="outline"
                onClick={handleAddStatus}
                disabled={statusName.trim().length === 0}
                className="h-8"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Names are normalized to lowercase with hyphens and must include at least three
              letters.
            </p>
            {error ? <p className="text-xs text-destructive">{error}</p> : null}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

type SortableStatusRowProps = {
  status: StatusRow;
  editingStatusName: string | null;
  editingNameValue: string;
  hasPendingMutation: boolean;
  onDeleteStatus: (name: string) => Promise<void>;
  onStartRename: (name: string) => void;
  onSaveRename: (currentName: string) => Promise<void>;
  onCancelRename: () => void;
  setEditingNameValue: React.Dispatch<React.SetStateAction<string>>;
};

function SortableStatusRow({
  status,
  editingStatusName,
  editingNameValue,
  hasPendingMutation,
  onDeleteStatus,
  onStartRename,
  onSaveRename,
  onCancelRename,
  setEditingNameValue
}: SortableStatusRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: status.name,
    disabled: hasPendingMutation || editingStatusName !== null
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'flex flex-wrap items-center gap-2 rounded-sm',
        isDragging ? 'bg-muted/60 opacity-70' : ''
      )}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7 cursor-grab active:cursor-grabbing"
        disabled={hasPendingMutation || editingStatusName !== null}
        aria-label={`Drag to reorder ${status.name}`}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-3.5 w-3.5" />
      </Button>

      {editingStatusName === status.name ? (
        <Input
          value={editingNameValue}
          onChange={event => setEditingNameValue(event.target.value)}
          className="h-7 w-[170px]"
          disabled={hasPendingMutation}
          onKeyDown={event => {
            if (event.key === 'Enter') {
              void onSaveRename(status.name);
            }
            if (event.key === 'Escape') {
              onCancelRename();
            }
          }}
          aria-label={`Edit ${status.name} name`}
        />
      ) : (
        <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{status.name}</code>
      )}

      <Badge variant="outline" className="rounded-full text-[11px]">
        Type: {statusTypeOptions.find(option => option.value === status.statusType)?.label}
      </Badge>

      {editingStatusName === status.name ? (
        <>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => onSaveRename(status.name)}
            disabled={hasPendingMutation || editingNameValue.trim().length === 0}
            aria-label={`Save ${status.name} name`}
          >
            <Check className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onCancelRename}
            disabled={hasPendingMutation}
            aria-label={`Cancel editing ${status.name}`}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => onStartRename(status.name)}
          disabled={hasPendingMutation}
          aria-label={`Rename ${status.name}`}
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      )}

      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7 text-destructive hover:text-destructive"
        onClick={() => onDeleteStatus(status.name)}
        disabled={hasPendingMutation || editingStatusName !== null}
        aria-label={`Delete ${status.name}`}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
