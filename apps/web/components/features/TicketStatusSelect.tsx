'use client';

import { useTransition } from 'react';

import { updateTicketStatusAction } from '@/lib/actions/tickets';
import { capitalizeFirst } from '@/lib/options';

import { Select, SelectContent, SelectItem, SelectTrigger } from '../ui/select';

type Props = {
  ticketId: string;
  currentStatus: string;
  statusOptions: string[];
};

export function TicketStatusSelect({ ticketId, currentStatus, statusOptions }: Props) {
  const [pending, startTransition] = useTransition();

  function handleChange(value: string) {
    startTransition(async () => {
      await updateTicketStatusAction(ticketId, value);
    });
  }

  return (
    <Select value={currentStatus} disabled={pending} onValueChange={handleChange}>
      <SelectTrigger
        id="ticket-status-select"
        aria-label="Select status"
        className="h-6 w-auto rounded-lg border bg-transparent px-3 text-xs font-base hover:bg-muted"
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
