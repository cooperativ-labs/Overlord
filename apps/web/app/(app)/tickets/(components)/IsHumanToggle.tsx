'use client';

import { Bot, User } from 'lucide-react';
import { useEffect, useState } from 'react';

import { useUpdateTicketForHumanMutation } from '@/lib/client-data/tickets/mutations';
import { cn } from '@/lib/utils';

const sizeClasses = {
  sm: { button: 'h-5 w-5', icon: 'h-3 w-3' },
  md: { button: 'h-7 w-7', icon: 'h-4 w-4' }
};

type IsHumanToggleBaseProps = {
  forHuman: boolean;
  size?: 'sm' | 'md';
  className?: string;
};

type IsHumanTogglePersistedProps = IsHumanToggleBaseProps & {
  ticketId: string;
  onForHumanChange?: never;
};

type IsHumanToggleDraftProps = IsHumanToggleBaseProps & {
  ticketId?: never;
  onForHumanChange: (forHuman: boolean) => void;
};

export function IsHumanToggle(props: IsHumanTogglePersistedProps | IsHumanToggleDraftProps) {
  const { forHuman, size = 'sm', className } = props;
  const [current, setCurrent] = useState(forHuman);
  const updateForHumanMutation = useUpdateTicketForHumanMutation();
  const { button: btnCls, icon: iconCls } = sizeClasses[size];
  const isDraft = 'onForHumanChange' in props && props.onForHumanChange !== undefined;

  useEffect(() => {
    setCurrent(forHuman);
  }, [forHuman]);

  const handleSetForHuman = (nextForHuman: boolean) => {
    if (nextForHuman === current) return;
    const prev = current;
    setCurrent(nextForHuman);
    if (isDraft) {
      props.onForHumanChange(nextForHuman);
      return;
    }
    updateForHumanMutation.mutate(
      { ticketId: props.ticketId, forHuman: nextForHuman },
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
        aria-pressed={!current}
        disabled={!isDraft && updateForHumanMutation.isPending}
        onClick={event => {
          event.stopPropagation();
          handleSetForHuman(false);
        }}
        className={cn(
          'flex items-center justify-center rounded-full transition-colors',
          btnCls,
          !current
            ? 'bg-background text-emerald-700 shadow-sm'
            : 'text-muted-foreground hover:text-emerald-700'
        )}
      >
        <Bot className={iconCls} />
      </button>
      <button
        type="button"
        aria-label="Assign to human"
        aria-pressed={current}
        disabled={!isDraft && updateForHumanMutation.isPending}
        onClick={event => {
          event.stopPropagation();
          handleSetForHuman(true);
        }}
        className={cn(
          'flex items-center justify-center rounded-full transition-colors',
          btnCls,
          current
            ? 'bg-background text-amber-800 shadow-sm'
            : 'text-muted-foreground hover:text-amber-800'
        )}
      >
        <User className={iconCls} />
      </button>
    </div>
  );
}
