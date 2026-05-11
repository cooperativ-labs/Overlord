'use client';

import { Bot, User } from 'lucide-react';

import { useUpdateTicketExecutionTargetMutation } from '@/lib/client-data/tickets/mutations';
import { cn } from '@/lib/utils';
import type { Database } from '@/types/database.types';

type ExecutionTarget = Database['public']['Enums']['ticket_execution_target'];

export function ExecutionTargetToggle({
  ticketId,
  executionTarget,
  className
}: {
  ticketId: string;
  executionTarget: ExecutionTarget;
  className?: string;
}) {
  const updateExecutionTargetMutation = useUpdateTicketExecutionTargetMutation();

  const handleSetExecutionTarget = (nextTarget: ExecutionTarget) => {
    if (nextTarget === executionTarget) return;
    updateExecutionTargetMutation.mutate({ ticketId, executionTarget: nextTarget });
  };

  return (
    <div
      className={cn(
        'flex items-center rounded-full border border-border/60 bg-background/30 p-0.5',
        className
      )}
    >
      <button
        type="button"
        aria-label="Assign to agent"
        aria-pressed={executionTarget === 'agent'}
        disabled={updateExecutionTargetMutation.isPending}
        onClick={event => {
          event.stopPropagation();
          handleSetExecutionTarget('agent');
        }}
        className={cn(
          'flex h-5 w-5 items-center justify-center rounded-full transition-colors',
          executionTarget === 'agent'
            ? 'bg-background text-emerald-700 shadow-sm'
            : 'text-muted-foreground hover:text-emerald-700'
        )}
      >
        <Bot className="h-3 w-3" />
      </button>
      <button
        type="button"
        aria-label="Assign to human"
        aria-pressed={executionTarget === 'human'}
        disabled={updateExecutionTargetMutation.isPending}
        onClick={event => {
          event.stopPropagation();
          handleSetExecutionTarget('human');
        }}
        className={cn(
          'flex h-5 w-5 items-center justify-center rounded-full transition-colors',
          executionTarget === 'human'
            ? 'bg-background text-amber-800 shadow-sm'
            : 'text-muted-foreground hover:text-amber-800'
        )}
      >
        <User className="h-3 w-3" />
      </button>
    </div>
  );
}
