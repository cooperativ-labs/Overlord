'use client';

import { Bot, User } from 'lucide-react';
import { useEffect, useState } from 'react';

import { useUpdateTicketExecutionTargetMutation } from '@/lib/client-data/tickets/mutations';
import { cn } from '@/lib/utils';
import type { Database } from '@/types/database.types';

type ExecutionTarget = Database['public']['Enums']['ticket_execution_target'];

const sizeClasses = {
  sm: { button: 'h-5 w-5', icon: 'h-3 w-3' },
  md: { button: 'h-7 w-7', icon: 'h-4 w-4' }
};

export function ExecutionTargetToggle({
  ticketId,
  executionTarget,
  size = 'sm',
  className
}: {
  ticketId: string;
  executionTarget: ExecutionTarget;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const [current, setCurrent] = useState(executionTarget);
  const updateExecutionTargetMutation = useUpdateTicketExecutionTargetMutation();
  const { button: btnCls, icon: iconCls } = sizeClasses[size];

  useEffect(() => {
    setCurrent(executionTarget);
  }, [executionTarget]);

  const handleSetExecutionTarget = (nextTarget: ExecutionTarget) => {
    if (nextTarget === current) return;
    const prev = current;
    setCurrent(nextTarget);
    updateExecutionTargetMutation.mutate(
      { ticketId, executionTarget: nextTarget },
      { onError: () => setCurrent(prev) }
    );
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
        aria-pressed={current === 'agent'}
        disabled={updateExecutionTargetMutation.isPending}
        onClick={event => {
          event.stopPropagation();
          handleSetExecutionTarget('agent');
        }}
        className={cn(
          'flex items-center justify-center rounded-full transition-colors',
          btnCls,
          current === 'agent'
            ? 'bg-background text-emerald-700 shadow-sm'
            : 'text-muted-foreground hover:text-emerald-700'
        )}
      >
        <Bot className={iconCls} />
      </button>
      <button
        type="button"
        aria-label="Assign to human"
        aria-pressed={current === 'human'}
        disabled={updateExecutionTargetMutation.isPending}
        onClick={event => {
          event.stopPropagation();
          handleSetExecutionTarget('human');
        }}
        className={cn(
          'flex items-center justify-center rounded-full transition-colors',
          btnCls,
          current === 'human'
            ? 'bg-background text-amber-800 shadow-sm'
            : 'text-muted-foreground hover:text-amber-800'
        )}
      >
        <User className={iconCls} />
      </button>
    </div>
  );
}
