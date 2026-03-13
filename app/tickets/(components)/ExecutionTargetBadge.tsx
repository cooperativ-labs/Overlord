'use client';

import { Bot, UserRound } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { Database } from '@/types/database.types';

type ExecutionTarget = Database['public']['Enums']['ticket_execution_target'];

const executionTargetTheme = {
  agent: {
    badgeClassName:
      'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-200',
    label: 'Agent',
    Icon: Bot
  },
  human: {
    badgeClassName:
      'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200',
    label: 'Human',
    Icon: UserRound
  }
} as const;

export function ExecutionTargetBadge({
  executionTarget,
  className
}: {
  executionTarget: ExecutionTarget;
  className?: string;
}) {
  const { badgeClassName, Icon, label } = executionTargetTheme[executionTarget];

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
