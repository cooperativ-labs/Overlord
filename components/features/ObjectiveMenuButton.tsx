'use client';

import { MoreHorizontal } from 'lucide-react';
import { useTransition } from 'react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { markObjectiveExecutedAction } from '@/lib/actions/tickets';

type ObjectiveMenuButtonProps = {
  ticketId: string;
  objectiveId: string;
  isExecuted: boolean;
  canMarkExecuted?: boolean;
};

export function ObjectiveMenuButton({
  ticketId,
  objectiveId,
  isExecuted,
  canMarkExecuted = true
}: ObjectiveMenuButtonProps) {
  const [pending, startTransition] = useTransition();

  function handleMarkExecuted() {
    startTransition(async () => {
      await markObjectiveExecutedAction(ticketId, objectiveId);
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label="Objective options"
          className="h-7 w-7"
          size="icon"
          variant="ghost"
          onClick={event => event.stopPropagation()}
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          disabled={pending || isExecuted || !canMarkExecuted}
          onSelect={event => {
            event.preventDefault();
            handleMarkExecuted();
          }}
        >
          Mark executed
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
