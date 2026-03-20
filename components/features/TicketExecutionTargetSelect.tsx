'use client';

import { useTransition } from 'react';

import { updateTicketExecutionTargetAction } from '@/lib/actions/tickets';
import { capitalizeFirst, ticketExecutionTargetOptions } from '@/lib/options';
import type { Database } from '@/types/database.types';

import { Select, SelectContent, SelectItem, SelectTrigger } from '../ui/select';

type ExecutionTarget = Database['public']['Enums']['ticket_execution_target'];

type Props = {
  ticketId: string;
  currentExecutionTarget: ExecutionTarget;
};

export function TicketExecutionTargetSelect({ ticketId, currentExecutionTarget }: Props) {
  const [pending, startTransition] = useTransition();

  function handleChange(value: string) {
    const nextExecutionTarget = value as ExecutionTarget;
    startTransition(async () => {
      await updateTicketExecutionTargetAction(ticketId, nextExecutionTarget);
    });
  }

  return (
    <Select
      value={currentExecutionTarget}
      disabled={pending}
      onValueChange={handleChange}
      aria-label="Execution target"
    >
      <SelectTrigger
        id="ticket-execution-target-select"
        aria-label="Select execution target"
        className="h-6 w-auto rounded-lg border bg-transparent px-3 text-xs font-base hover:bg-muted"
      >
        {capitalizeFirst(currentExecutionTarget)}
      </SelectTrigger>
      <SelectContent>
        {ticketExecutionTargetOptions.map(({ value, label }) => (
          <SelectItem key={value} value={value}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
