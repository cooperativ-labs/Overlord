'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import type { ButtonLoadingState } from '@/components/ui/loading-button';
import { LoadingButton } from '@/components/ui/loading-button';
import { createTicketStatusAction } from '@/lib/actions/ticket-statuses';
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
          statuses.map(status => (
            <div key={status.name} className="flex flex-wrap items-center gap-2">
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{status.name}</code>
              <Badge variant="outline" className="rounded-full text-[11px]">
                Type: {statusTypeOptions.find(option => option.value === status.statusType)?.label}
              </Badge>
              {status.isDefault ? (
                <Badge variant="secondary" className="rounded-full text-[11px]">
                  Default
                </Badge>
              ) : null}
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
        Use lowercase names with hyphens; spaces are converted to hyphens automatically.
      </p>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
