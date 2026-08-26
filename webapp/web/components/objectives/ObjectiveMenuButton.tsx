import {
  Check,
  CheckCircle2,
  Copy,
  MessageSquare,
  MoreVertical,
  Pencil,
  RotateCcw,
  Trash2
} from 'lucide-react';
import { useState } from 'react';

import type { ObjectiveState } from '../../../shared/contract.ts';
import { useCopyToClipboard } from '../../lib/hooks/use-copy-to-clipboard.ts';
import { useDeleteObjective, useUpdateObjective } from '../../lib/queries.ts';
import { Button } from '../ui/button.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../ui/dialog.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '../ui/dropdown-menu.tsx';

type ObjectiveMenuButtonProps = {
  objectiveId: string;
  displayId?: string;
  state: ObjectiveState;
  onEditTitle?: () => void;
  /**
   * Shell command that reopens the agent's native session for this objective
   * (e.g. `claude --resume <id>`). When present, the menu offers a copy action
   * so the user can continue the agent's own conversation in a terminal to
   * discuss what happened — this stays entirely outside Overlord (no execution
   * request, session, or objective state change). Omitted/null hides the item.
   */
  resumeCommand?: string | null;
};

/**
 * Kebab menu of actions for a single objective. Replaces the inline state
 * badge that previously doubled as a state picker: state transitions are now
 * explicit menu items ("Mark complete" / "Mark draft") alongside delete, so the
 * objective row reads as a summary rather than an editable control.
 */
export function ObjectiveMenuButton({
  objectiveId,
  displayId,
  state,
  onEditTitle,
  resumeCommand = null
}: ObjectiveMenuButtonProps) {
  const update = useUpdateObjective();
  const remove = useDeleteObjective();
  const { copied, copy } = useCopyToClipboard();
  const { copied: resumeCopied, copy: copyResume } = useCopyToClipboard();
  const [confirmDisconnectOpen, setConfirmDisconnectOpen] = useState(false);

  const pending = update.isPending || remove.isPending;

  const canShowMarkComplete = state !== 'complete' && state !== 'future';
  const canShowMarkDraft = state !== 'draft' && state !== 'future';

  function setState(next: ObjectiveState) {
    update.mutate({ id: objectiveId, body: { state: next } });
  }

  function markDraft() {
    if (state === 'executing') {
      setConfirmDisconnectOpen(true);
      return;
    }
    setState('draft');
  }

  async function confirmDisconnect() {
    await update.mutateAsync({ id: objectiveId, body: { state: 'draft' } });
    setConfirmDisconnectOpen(false);
  }

  function handleDelete() {
    if (confirm('Delete this objective?')) remove.mutate(objectiveId);
  }

  async function handleCopyId() {
    await copy(displayId || objectiveId);
  }

  async function handleCopyResume() {
    if (resumeCommand) await copyResume(resumeCommand);
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Objective options"
          title="Objective options"
          className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
          onClick={event => event.stopPropagation()}
        >
          <MoreVertical className="h-4 w-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[160px]">
          {onEditTitle ? (
            <DropdownMenuItem className="gap-2 text-xs" onClick={onEditTitle}>
              <Pencil className="h-3.5 w-3.5" />
              Edit title
            </DropdownMenuItem>
          ) : null}
          {canShowMarkComplete ? (
            <DropdownMenuItem
              className="gap-2 text-xs"
              disabled={pending}
              onClick={() => setState('complete')}
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              Mark complete
            </DropdownMenuItem>
          ) : null}
          {canShowMarkDraft ? (
            <DropdownMenuItem className="gap-2 text-xs" disabled={pending} onClick={markDraft}>
              <RotateCcw className="h-3.5 w-3.5" />
              Mark draft
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem className="gap-2 text-xs" onClick={handleCopyId}>
            {copied ? (
              <Check className="h-3.5 w-3.5 text-green-600" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
            Copy {displayId || 'objective ID'}
          </DropdownMenuItem>
          {resumeCommand ? (
            <DropdownMenuItem className="gap-2 text-xs" onClick={handleCopyResume}>
              {resumeCopied ? (
                <Check className="h-3.5 w-3.5 text-green-600" />
              ) : (
                <MessageSquare className="h-3.5 w-3.5" />
              )}
              Copy resume command
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            className="gap-2 text-xs"
            variant="destructive"
            disabled={pending}
            onClick={handleDelete}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={confirmDisconnectOpen} onOpenChange={setConfirmDisconnectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disconnect this executing objective?</DialogTitle>
            <DialogDescription>
              Moving an executing objective to Draft ends its active session and clears its pending
              launch. Any existing draft becomes the first future objective.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirmDisconnectOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() => void confirmDisconnect()}
            >
              {update.isPending ? 'Disconnecting…' : 'Move to Draft'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
