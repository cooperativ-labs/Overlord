'use client';

import { useEffect, useState } from 'react';

import { useUpdateTicketExecutionTargetMutation } from '@/lib/client-data/tickets/mutations';
import { capitalizeFirst, ticketExecutionTargetOptions } from '@/lib/options';
import type { Database } from '@/types/database.types';

import { Select, SelectContent, SelectItem, SelectTrigger } from '../ui/select';

type ExecutionTarget = Database['public']['Enums']['ticket_execution_target'];

type Props = {
  ticketId: string;
  currentExecutionTarget: ExecutionTarget;
};

export function TicketExecutionTargetSelect({ ticketId, currentExecutionTarget }: Props) {
  const [executionTarget, setExecutionTarget] = useState(currentExecutionTarget);
  const mutation = useUpdateTicketExecutionTargetMutation();

  useEffect(() => {
    setExecutionTarget(currentExecutionTarget);
  }, [currentExecutionTarget]);

  function handleChange(value: string) {
    const nextExecutionTarget = value as ExecutionTarget;
    const previousExecutionTarget = executionTarget;
    setExecutionTarget(nextExecutionTarget);
    mutation.mutate(
      { ticketId, executionTarget: nextExecutionTarget },
      {
        onError: () => {
          setExecutionTarget(previousExecutionTarget);
        }
      }
    );
  }

  return (
    <Select
      value={executionTarget}
      disabled={mutation.isPending}
      onValueChange={handleChange}
      aria-label="Execution target"
    >
      <SelectTrigger
        id="ticket-execution-target-select"
        aria-label="Select execution target"
        className="h-6 w-auto rounded-lg border bg-transparent px-3 text-xs font-base hover:bg-muted"
      >
        {capitalizeFirst(executionTarget)}
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
