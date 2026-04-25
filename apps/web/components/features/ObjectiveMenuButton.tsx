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
import { markObjectiveDraftAction, markObjectiveExecutedAction } from '@/lib/actions/tickets';
import { withElectronActionRetry } from '@/lib/electron-auth/action-retry';

const markObjectiveDraftActionWithRetry = withElectronActionRetry(markObjectiveDraftAction);
const markObjectiveExecutedActionWithRetry = withElectronActionRetry(markObjectiveExecutedAction);

type ObjectiveMenuButtonProps = {
  ticketId: string;
  objectiveId: string;
  state: string | null;
  canMarkExecuted?: boolean;
};

export function ObjectiveMenuButton({
  ticketId,
  objectiveId,
  state,
  canMarkExecuted = true
}: ObjectiveMenuButtonProps) {
  const [pending, startTransition] = useTransition();

  function handleMarkExecuted() {
    startTransition(async () => {
      await markObjectiveExecutedActionWithRetry(ticketId, objectiveId);
    });
  }

  function handleMarkDraft() {
    startTransition(async () => {
      await markObjectiveDraftActionWithRetry(ticketId, objectiveId);
    });
  }

  const canShowMarkComplete = state !== 'complete';
  const canShowMarkDraft = state !== 'draft';

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
        {canShowMarkComplete ? (
          <DropdownMenuItem
            disabled={pending || !canMarkExecuted}
            onSelect={event => {
              event.preventDefault();
              handleMarkExecuted();
            }}
          >
            Mark complete
          </DropdownMenuItem>
        ) : null}
        {canShowMarkDraft ? (
          <DropdownMenuItem
            disabled={pending}
            onSelect={event => {
              event.preventDefault();
              handleMarkDraft();
            }}
          >
            Mark draft
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
