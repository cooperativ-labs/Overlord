'use client';

import { Copy, MoreVertical, Trash2 } from 'lucide-react';
import { useMemo, useTransition } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import {
  deleteFutureObjectiveAction,
  markObjectiveDraftAction,
  markObjectiveExecutedAction
} from '@/lib/actions/tickets';
import { withElectronActionRetry } from '@/lib/electron-auth/action-retry';
import { buildNativeResumeCommand } from '@/lib/overlord/launch-commands';

const markObjectiveDraftActionWithRetry = withElectronActionRetry(markObjectiveDraftAction);
const markObjectiveExecutedActionWithRetry = withElectronActionRetry(markObjectiveExecutedAction);
const deleteFutureObjectiveActionWithRetry = withElectronActionRetry(deleteFutureObjectiveAction);

type ObjectiveMenuButtonProps = {
  ticketId: string;
  objectiveId: string;
  state: string | null;
  canMarkExecuted?: boolean;
  agentIdentifier?: string | null;
  externalSessionId?: string | null;
};

export function ObjectiveMenuButton({
  ticketId,
  objectiveId,
  state,
  canMarkExecuted = true,
  agentIdentifier = null,
  externalSessionId = null
}: ObjectiveMenuButtonProps) {
  const [pending, startTransition] = useTransition();
  const resumeCommand = useMemo(
    () => buildNativeResumeCommand(agentIdentifier, externalSessionId),
    [agentIdentifier, externalSessionId]
  );

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

  function handleDeleteFuture() {
    startTransition(async () => {
      await deleteFutureObjectiveActionWithRetry({ ticketId, objectiveId });
    });
  }

  async function handleCopyResumeCommand() {
    if (!resumeCommand) return;
    try {
      await navigator.clipboard.writeText(resumeCommand);
      toast.success('Resume command copied to clipboard.');
    } catch {
      toast.error('Could not copy to clipboard.');
    }
  }

  const canShowMarkComplete = state !== 'complete' && state !== 'future';
  const canShowMarkDraft = state !== 'draft' && state !== 'future';
  const canShowDeleteFuture = state === 'future';

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
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {resumeCommand ? (
          <DropdownMenuItem
            onSelect={event => {
              event.preventDefault();
              void handleCopyResumeCommand();
            }}
          >
            <Copy className="mr-2 h-4 w-4" />
            Copy resume command
          </DropdownMenuItem>
        ) : null}
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
        {canShowDeleteFuture ? (
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            disabled={pending}
            onSelect={event => {
              event.preventDefault();
              handleDeleteFuture();
            }}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Delete
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
