'use client';

import { useTransition } from 'react';

import { updateTicketExecutionTargetAction } from '@/lib/actions/tickets';
import { ticketExecutionTargetOptions } from '@/lib/options';
import type { Database } from '@/types/database.types';

type ExecutionTarget = Database['public']['Enums']['ticket_execution_target'];

type Props = {
  ticketId: string;
  currentExecutionTarget: ExecutionTarget;
};

export function TicketExecutionTargetSelect({ ticketId, currentExecutionTarget }: Props) {
  const [pending, startTransition] = useTransition();

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const nextExecutionTarget = e.target.value as ExecutionTarget;
    startTransition(async () => {
      await updateTicketExecutionTargetAction(ticketId, nextExecutionTarget);
    });
  }

  return (
    <select
      className="h-7 cursor-pointer rounded-full border border-dashed bg-transparent px-3 text-xs font-medium hover:bg-muted disabled:opacity-50"
      defaultValue={currentExecutionTarget}
      disabled={pending}
      onChange={handleChange}
      aria-label="Execution target"
    >
      {ticketExecutionTargetOptions.map(({ value, label }) => (
        <option key={value} value={value}>
          {label}
        </option>
      ))}
    </select>
  );
}
