'use client';

import { Check, Copy, MoreVertical, Trash2 } from 'lucide-react';
import { useMemo, useState, useTransition } from 'react';

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
  onEditTitle?: () => void;
};

export function ObjectiveMenuButton({
  ticketId,
  objectiveId,
  state,
  canMarkExecuted = true,
  agentIdentifier = null,
  externalSessionId = null,
  onEditTitle
}: ObjectiveMenuButtonProps) {
  const [pending, startTransition] = useTransition();
  const [resumeCopied, setResumeCopied] = useState(false);
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
      setResumeCopied(true);
      window.setTimeout(() => setResumeCopied(false), 2000);
    } catch {
      setResumeCopied(false);
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
        {onEditTitle ? (
          <DropdownMenuItem
            onSelect={event => {
              event.preventDefault();
              onEditTitle();
            }}
          >
            Edit title
          </DropdownMenuItem>
        ) : null}
        {resumeCommand ? (
          <DropdownMenuItem
            className="justify-between"
            onSelect={event => {
              event.preventDefault();
              void handleCopyResumeCommand();
            }}
          >
            Copy resume command
            {resumeCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
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
