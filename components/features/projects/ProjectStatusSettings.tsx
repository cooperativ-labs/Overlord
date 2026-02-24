'use client';

import { ArrowDown, ArrowUp, Check, Pencil, Trash2, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { ButtonLoadingState } from '@/components/ui/loading-button';
import { LoadingButton } from '@/components/ui/loading-button';
import {
  createTicketStatusAction,
  deleteTicketStatusAction,
  reorderTicketStatusesAction,
  updateTicketStatusNameAction
} from '@/lib/actions/ticket-statuses';
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
};

export function ProjectStatusSettings({
  organizationId,
  projectId,
  initialStatuses
}: ProjectStatusSettingsProps) {
  const router = useRouter();
  const [statuses, setStatuses] = useState<StatusRow[]>(initialStatuses);
  const [statusName, setStatusName] = useState('');
  const [statusType, setStatusType] = useState<TicketStatusType>('execute');
  const [addButtonState, setAddButtonState] = useState<ButtonLoadingState>('default');
  const [pendingDeleteName, setPendingDeleteName] = useState<string | null>(null);
  const [pendingMoveName, setPendingMoveName] = useState<string | null>(null);
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

  async function handleMoveStatus(index: number, direction: 'up' | 'down') {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= statuses.length) {
      return;
    }

    const nextStatuses = [...statuses];
    const [movingStatus] = nextStatuses.splice(index, 1);
    nextStatuses.splice(targetIndex, 0, movingStatus);
    const movedStatusName = movingStatus.name;

    setPendingMoveName(movedStatusName);
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
      setError(cause instanceof Error ? cause.message : 'Failed to reorder statuses.');
    } finally {
      setPendingMoveName(null);
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
    pendingMoveName !== null ||
    pendingRenameName !== null;

  return (
    <div className="mt-5 grid gap-3 md:max-w-2xl">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Task Statuses
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Statuses define board columns and apply across this organization.
        </p>
      </div>

      <div className="grid gap-2 rounded-md border p-3">
        {statuses.length > 0 ? (
          statuses.map((status, index) => (
            <div key={status.name} className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => handleMoveStatus(index, 'up')}
                  disabled={hasPendingMutation || editingStatusName !== null || index === 0}
                  aria-label={`Move ${status.name} up`}
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => handleMoveStatus(index, 'down')}
                  disabled={
                    hasPendingMutation ||
                    editingStatusName !== null ||
                    index === statuses.length - 1
                  }
                  aria-label={`Move ${status.name} down`}
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </Button>
              </div>
              {editingStatusName === status.name ? (
                <Input
                  value={editingNameValue}
                  onChange={event => setEditingNameValue(event.target.value)}
                  className="h-7 w-[170px]"
                  disabled={hasPendingMutation}
                  onKeyDown={event => {
                    if (event.key === 'Enter') {
                      void handleSaveRename(status.name);
                    }
                    if (event.key === 'Escape') {
                      handleCancelRename();
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
                    onClick={() => handleSaveRename(status.name)}
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
                    onClick={handleCancelRename}
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
                  onClick={() => handleStartRename(status.name)}
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
                onClick={() => handleDeleteStatus(status.name)}
                disabled={hasPendingMutation || editingStatusName !== null}
                aria-label={`Delete ${status.name}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))
        ) : (
          <p className="text-xs text-muted-foreground">No statuses found for this organization.</p>
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
        Names are normalized to lowercase with hyphens and must include at least three letters.
      </p>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
