'use client';

import { useTransition } from 'react';

import { updateTicketStatusAction } from '@/lib/actions/tickets';
import { capitalizeFirst } from '@/lib/options';

type Props = {
  ticketId: string;
  currentStatus: string;
  statusOptions: string[];
};

export function TicketStatusSelect({ ticketId, currentStatus, statusOptions }: Props) {
  const [pending, startTransition] = useTransition();

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const nextStatus = e.target.value;
    startTransition(async () => {
      await updateTicketStatusAction(ticketId, nextStatus);
    });
  }

  return (
    <select
      className="h-7 cursor-pointer rounded-full border border-dashed bg-transparent px-3 text-xs font-medium hover:bg-muted disabled:opacity-50"
      defaultValue={currentStatus}
      disabled={pending}
      onChange={handleChange}
    >
      {statusOptions.map(status => (
        <option key={status} value={status}>
          {capitalizeFirst(status)}
        </option>
      ))}
    </select>
  );
}
