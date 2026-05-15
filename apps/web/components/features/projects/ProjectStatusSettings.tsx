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
import { Check, ChevronDown, GripVertical, Pencil, Star, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import type { ButtonLoadingState } from '@/components/ui/loading-button';
import { LoadingButton } from '@/components/ui/loading-button';
import { useTicketStatuses } from '@/lib/client-data/tickets/hooks';
import {
  useCreateTicketStatusMutation,
  useDeleteTicketStatusMutation,
  useRenameTicketStatusMutation,
  useReorderTicketStatusesMutation,
  useSetDefaultTicketStatusMutation
} from '@/lib/client-data/tickets/status-mutations';
import { ticketStatusTypeOptions } from '@/lib/options';
import { cn } from '@/lib/utils';
import type { Database } from '@/types/database.types';

type TicketStatusType = Database['public']['Enums']['ticket_status_type'];

const statusTypeOptions = ticketStatusTypeOptions;
const exclusiveStatusTypes: TicketStatusType[] = ['execute', 'review'];
const preferredStatusTypeOrder: TicketStatusType[] = ['execute', 'review', 'draft', 'complete'];

function isExclusiveStatusType(statusType: TicketStatusType): boolean {
  return exclusiveStatusTypes.includes(statusType);
}

function isLockedStatusType(
  statusType: TicketStatusType,
  statusTypeUsage: Partial<Record<TicketStatusType, string>>
): boolean {
  return isExclusiveStatusType(statusType) && Boolean(statusTypeUsage[statusType]);
}

function getDefaultStatusType(statuses: StatusRow[]): TicketStatusType {
  const usedExclusiveTypes = new Set(
    statuses
      .filter(status => isExclusiveStatusType(status.statusType))
      .map(status => status.statusType)
  );

  for (const statusType of preferredStatusTypeOrder) {
    if (!isExclusiveStatusType(statusType) || !usedExclusiveTypes.has(statusType)) {
      return statusType;
    }
  }

  return 'draft';
}

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
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const initialQueryStatuses = useMemo(
    () =>
      initialStatuses.map(status => ({
        name: status.name,
        position: status.position,
        status_type: status.statusType
      })),
    [initialStatuses]
  );
  const statusQuery = useTicketStatuses(organizationId, initialQueryStatuses);
  const statuses = useMemo<StatusRow[]>(
    () =>
      (statusQuery.data ?? []).map(status => ({
        name: status.name,
        position: status.position,
        statusType: (status.status_type ?? 'draft') as TicketStatusType,
        isDefault: initialStatuses.find(initial => initial.name === status.name)?.isDefault ?? false
      })),
    [initialStatuses, statusQuery.data]
  );
  const createStatusMutation = useCreateTicketStatusMutation();
  const deleteStatusMutation = useDeleteTicketStatusMutation();
  const renameStatusMutation = useRenameTicketStatusMutation();
  const reorderStatusesMutation = useReorderTicketStatusesMutation();
  const setDefaultStatusMutation = useSetDefaultTicketStatusMutation();
  const [statusesOpen, setStatusesOpen] = useState(defaultExpanded);
  const [statusName, setStatusName] = useState('');
  const [statusType, setStatusType] = useState<TicketStatusType>(() =>
    getDefaultStatusType(initialStatuses)
  );
  const [addButtonState, setAddButtonState] = useState<ButtonLoadingState>('default');
  const [pendingDeleteName, setPendingDeleteName] = useState<string | null>(null);
  const [pendingReorder, setPendingReorder] = useState(false);
  const [pendingRenameName, setPendingRenameName] = useState<string | null>(null);
  const [editingStatusName, setEditingStatusName] = useState<string | null>(null);
  const [editingNameValue, setEditingNameValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [defaultStatusName, setDefaultStatusName] = useState<string | null>(
    () => initialStatuses.find(status => status.isDefault)?.name ?? null
  );

  useEffect(() => {
    setStatusType(prevStatusType => {
      if (!isExclusiveStatusType(prevStatusType)) {
        return prevStatusType;
      }

      const isStillAvailable = !statuses.some(status => status.statusType === prevStatusType);
      if (isStillAvailable) {
        return prevStatusType;
      }

      return getDefaultStatusType(statuses);
    });
  }, [statuses]);

  const statusTypeUsage = statuses.reduce(
    (usage, status) => {
      if (isExclusiveStatusType(status.statusType) && !usage[status.statusType]) {
        usage[status.statusType] = status.name;
      }
      return usage;
    },
    {} as Partial<Record<TicketStatusType, string>>
  );
  const selectedStatusTypeIsTaken = isLockedStatusType(statusType, statusTypeUsage);

  async function handleAddStatus() {
    setAddButtonState('loading');
    setError(null);

    try {
      await createStatusMutation.mutateAsync({
        organizationId,
        projectId,
        name: statusName,
        statusType
      });

      setStatusName('');
      setStatusType(currentStatusType => {
        if (!isExclusiveStatusType(currentStatusType)) {
          return currentStatusType;
        }

        const nextStatuses = [
          ...statuses,
          {
            name: statusName,
            position: statuses.length,
            statusType,
            isDefault: false
          }
        ];
        const isStillAvailable = !nextStatuses.some(
          status => status.statusType === currentStatusType
        );
        return isStillAvailable ? currentStatusType : getDefaultStatusType(nextStatuses);
      });
      setAddButtonState('success');
    } catch (cause) {
      setAddButtonState('error');
      setError(cause instanceof Error ? cause.message : 'Failed to add status.');
    }
  }

  async function handleSetDefault(name: string) {
    const previous = defaultStatusName;
    setDefaultStatusName(name);
    setError(null);

    try {
      await setDefaultStatusMutation.mutateAsync({ organizationId, projectId, name });
    } catch (cause) {
      setDefaultStatusName(previous);
      setError(cause instanceof Error ? cause.message : 'Failed to set default status.');
    }
  }

  async function handleDeleteStatus(name: string) {
    setPendingDeleteName(name);
    setError(null);

    try {
      await deleteStatusMutation.mutateAsync({
        organizationId,
        projectId,
        name
      });
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

    setPendingReorder(true);
    setError(null);

    try {
      await reorderStatusesMutation.mutateAsync({
        organizationId,
        projectId,
        orderedNames: nextStatuses.map(status => status.name)
      });
    } catch (cause) {
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
      await renameStatusMutation.mutateAsync({
        organizationId,
        projectId,
        currentName,
        nextName: editingNameValue
      });

      handleCancelRename();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to update status name.');
    } finally {
      setPendingRenameName(null);
    }
  }

  const hasPendingMutation =
    addButtonState === 'loading' ||
    createStatusMutation.isPending ||
    deleteStatusMutation.isPending ||
    renameStatusMutation.isPending ||
    reorderStatusesMutation.isPending ||
    setDefaultStatusMutation.isPending ||
    pendingDeleteName !== null ||
    pendingReorder ||
    pendingRenameName !== null;

  return (
    <div className="mt-5 md:max-w-2xl">
      <Collapsible open={statusesOpen} onOpenChange={setStatusesOpen} className="rounded-md border">
        <div className="flex items-center justify-between gap-3 px-3 py-2">
          <div>
            <p className="eyebrow">Task Statuses</p>
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
                        isDefault={defaultStatusName === status.name}
                        editingStatusName={editingStatusName}
                        editingNameValue={editingNameValue}
                        hasPendingMutation={hasPendingMutation}
                        onSetDefault={handleSetDefault}
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
                {statusTypeOptions.map(option => {
                  const isOptionLocked = isLockedStatusType(option.value, statusTypeUsage);

                  return (
                    <option key={option.value} value={option.value} disabled={isOptionLocked}>
                      {option.label}
                    </option>
                  );
                })}
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
                disabled={statusName.trim().length === 0 || selectedStatusTypeIsTaken}
                className="h-8"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Names are normalized to lowercase with hyphens and must include at least three
              letters.
            </p>
            <p className="text-xs text-muted-foreground">
              Execute and review can only be assigned once per organization.
              {statusTypeUsage.execute
                ? ` Execute is already assigned to ${statusTypeUsage.execute}.`
                : ' Execute is available.'}
              {statusTypeUsage.review
                ? ` Review is already assigned to ${statusTypeUsage.review}.`
                : ' Review is available.'}
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
  isDefault: boolean;
  editingStatusName: string | null;
  editingNameValue: string;
  hasPendingMutation: boolean;
  onSetDefault: (name: string) => Promise<void>;
  onDeleteStatus: (name: string) => Promise<void>;
  onStartRename: (name: string) => void;
  onSaveRename: (currentName: string) => Promise<void>;
  onCancelRename: () => void;
  setEditingNameValue: React.Dispatch<React.SetStateAction<string>>;
};

function SortableStatusRow({
  status,
  isDefault,
  editingStatusName,
  editingNameValue,
  hasPendingMutation,
  onSetDefault,
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

      {isDefault ? (
        <Badge variant="secondary" className="gap-1 rounded-full text-[11px]">
          <Star className="h-2.5 w-2.5 fill-current" />
          Default
        </Badge>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-[11px] text-muted-foreground"
          onClick={() => onSetDefault(status.name)}
          disabled={hasPendingMutation || editingStatusName !== null}
          aria-label={`Set ${status.name} as default status for new tickets`}
        >
          Set default
        </Button>
      )}

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
