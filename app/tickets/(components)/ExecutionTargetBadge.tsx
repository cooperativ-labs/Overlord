'use client';

import { Bot, UserRound } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { Database } from '@/types/database.types';

type ExecutionTarget = Database['public']['Enums']['ticket_execution_target'];

const executionTargetTheme = {
  agent: {
    accentClassName: 'border-l-emerald-500/70',
    badgeClassName:
      'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-200',
    cardClassName:
      'bg-emerald-50/45 dark:bg-emerald-950/10 hover:bg-emerald-50/70 dark:hover:bg-emerald-950/20',
    label: 'Agent',
    Icon: Bot
  },
  human: {
    accentClassName: 'border-l-amber-500/70',
    badgeClassName:
      'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200',
    cardClassName:
      'bg-amber-50/45 dark:bg-amber-950/10 hover:bg-amber-50/70 dark:hover:bg-amber-950/20',
    label: 'Human',
    Icon: UserRound
  }
} as const;

function getExecutionTargetTheme(executionTarget: ExecutionTarget) {
  return executionTargetTheme[executionTarget];
}

export function getExecutionTargetCardClassName(executionTarget: ExecutionTarget) {
  return cn('border-l-4', getExecutionTargetTheme(executionTarget).accentClassName);
}

export function getExecutionTargetSurfaceClassName(executionTarget: ExecutionTarget) {
  return getExecutionTargetTheme(executionTarget).cardClassName;
}

export function ExecutionTargetBadge({
  executionTarget,
  className
}: {
  executionTarget: ExecutionTarget;
  className?: string;
}) {
  const { badgeClassName, Icon, label } = getExecutionTargetTheme(executionTarget);

  return (
    <Badge
      variant="outline"
      className={cn(
        'gap-1 rounded-full px-2.5 py-0 text-[11px] font-medium',
        badgeClassName,
        className
      )}
    >
      <Icon className="h-3 w-3" />
      {label}
    </Badge>
  );
}
