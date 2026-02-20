'use client';

import { useTransition } from 'react';

import { updateTicketExecutionTargetAction } from '@/lib/actions/tickets';
import type { Database } from '@/types/database.types';

type ExecutionTarget = Database['public']['Enums']['ticket_execution_target'];

const executionTargetLabels: Record<ExecutionTarget, string> = {
  agent: 'Agent',
  human: 'Human'
};

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
      {(Object.keys(executionTargetLabels) as ExecutionTarget[]).map(target => (
        <option key={target} value={target}>
          {executionTargetLabels[target]}
        </option>
      ))}
    </select>
  );
}
