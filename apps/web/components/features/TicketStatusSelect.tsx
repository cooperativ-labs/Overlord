'use client';

import { useTransition } from 'react';

import { useUpdateTicketStatusMutation } from '@/lib/client-data/tickets/mutations';
import { capitalizeFirst } from '@/lib/options';

import { Select, SelectContent, SelectItem, SelectTrigger } from '../ui/select';

type Props = {
  ticketId: string;
  currentStatus: string;
  statusOptions: string[];
};

export function TicketStatusSelect({ ticketId, currentStatus, statusOptions }: Props) {
  const [pending, startTransition] = useTransition();
  const updateStatusMutation = useUpdateTicketStatusMutation();

  function handleChange(value: string) {
    startTransition(async () => {
      await updateStatusMutation.mutateAsync({ ticketId, status: value });
    });
  }

  return (
    <Select value={currentStatus} disabled={pending} onValueChange={handleChange}>
      <SelectTrigger
        id="ticket-status-select"
        aria-label="Select status"
        className="h-6 w-auto rounded-md border bg-transparent px-3 text-xs font-base hover:bg-muted"
      >
        {capitalizeFirst(currentStatus)}
      </SelectTrigger>
      <SelectContent>
        {statusOptions.map(status => (
          <SelectItem key={status} value={status}>
            {capitalizeFirst(status)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
