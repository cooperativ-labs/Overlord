import type { ObjectiveState, ProjectResourceDto } from '@overlord/contract';
import {
  ArrowDown,
  ArrowUp,
  Check,
  CheckCircle2,
  Copy,
  FolderOpen,
  ListOrdered,
  Loader2,
  MessageSquare,
  MoreVertical,
  Pencil,
  Play,
  RotateCcw,
  Trash2,
  Unplug
} from 'lucide-react';
import { useState } from 'react';

import { useCopyToClipboard } from '../../lib/hooks/use-copy-to-clipboard.ts';
import { useDeleteObjective, useUpdateObjective } from '../../lib/queries.ts';
import { cn } from '../../lib/utils.ts';
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
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '../ui/dropdown-menu.tsx';

import { objectiveResourceOptions } from './ObjectiveResourcePicker.tsx';

/** "Run" at the top of the menu (coo:1289). */
export type ObjectiveMenuRunAction = {
  label: string;
  onRun: () => void;
  /** Shown under the label of a disabled item, so the person knows why. */
  disabledReason?: string | null;
  pending?: boolean;
};

/** "Resource" submenu: which project resource the objective runs against (coo:1289). */
export type ObjectiveMenuResourceAction = {
  resources: ProjectResourceDto[];
  /** The objective's resource key; null inherits the project primary. */
  value: string | null;
  onChange: (resourceKey: string | null) => void;
  disabled?: boolean;
};

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
  /** Agent's native session id; when present the menu offers a copy action. */
  sessionId?: string | null;
  /** "Add to queue…": opens the Run Queue popover in its add view. */
  onOpenAddToQueue?: () => void;
  /** Keyboard reordering. Each item shows only when its handler is given. */
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  /** Offer "Force disconnect" (with its confirmation) for an executing objective. */
  showForceDisconnect?: boolean;
  /** Called after the objective was deleted, so a host can close its detail. */
  onDeleted?: () => void;
  /** Offer "Run" first. Hosts pass it for objectives that have not started. */
  run?: ObjectiveMenuRunAction;
  /** Offer the "Resource" submenu. Hidden when the project has one logical resource. */
  resource?: ObjectiveMenuResourceAction;
  /** Extra trigger classes (size on dense rows). */
  triggerClassName?: string;
};

/**
 * Kebab menu of actions for a single objective, in every state. Groups, in order: Run and the
 * Resource submenu (not-started rows, coo:1289); copy
 * (objective ID, resume command, session ID); Edit title; Move up / Move down (keyboard
 * reordering of not-started objectives); Add to queue…; Mark complete / Mark draft (with the
 * executing and complete confirmations); Force disconnect (executing); Delete. Items whose
 * handler is absent are hidden, so hosts opt into what their state allows.
 *
 * Every click inside stops propagation: the menu sits on rows that open on click.
 */
export function ObjectiveMenuButton({
  objectiveId,
  displayId,
  state,
  onEditTitle,
  resumeCommand = null,
  sessionId = null,
  onOpenAddToQueue,
  onMoveUp,
  onMoveDown,
  showForceDisconnect = false,
  onDeleted,
  run,
  resource,
  triggerClassName
}: ObjectiveMenuButtonProps) {
  const update = useUpdateObjective();
  const remove = useDeleteObjective();
  const { copied, copy } = useCopyToClipboard();
  const { copied: resumeCopied, copy: copyResume } = useCopyToClipboard();
  const { copied: sessionCopied, copy: copySession } = useCopyToClipboard();
  const [confirmDisconnectOpen, setConfirmDisconnectOpen] = useState(false);
  const [confirmReopenOpen, setConfirmReopenOpen] = useState(false);
  const [confirmForceDisconnectOpen, setConfirmForceDisconnectOpen] = useState(false);

  const pending = update.isPending || remove.isPending;

  const canShowMarkComplete = state !== 'complete';
  const canShowMarkDraft = state !== 'draft';
  const canShowForceDisconnect = showForceDisconnect && state === 'executing';
  const canShowMove = Boolean(onMoveUp || onMoveDown);
  const canShowQueue = Boolean(onOpenAddToQueue);
  const resourceOptions = resource
    ? objectiveResourceOptions(resource.resources, resource.value)
    : null;
  const runDisabled = Boolean(run?.disabledReason) || Boolean(run?.pending);

  function setState(next: ObjectiveState) {
    update.mutate({ id: objectiveId, body: { state: next } });
  }

  function markDraft() {
    if (state === 'executing') {
      setConfirmDisconnectOpen(true);
      return;
    }
    if (state === 'complete') {
      // A completed objective carries evidence. The confirmation exists to say
      // that reopening keeps it (coo:879 §4.6), not to make the action harder.
      setConfirmReopenOpen(true);
      return;
    }
    setState('draft');
  }

  async function confirmDisconnect() {
    await update.mutateAsync({ id: objectiveId, body: { state: 'draft' } });
    setConfirmDisconnectOpen(false);
  }

  async function confirmReopen() {
    await update.mutateAsync({ id: objectiveId, body: { state: 'draft' } });
    setConfirmReopenOpen(false);
  }

  async function confirmForceDisconnect() {
    await update.mutateAsync({ id: objectiveId, body: { state: 'draft' } });
    setConfirmForceDisconnectOpen(false);
  }

  function handleDelete() {
    if (confirm('Delete this objective?')) {
      remove.mutate(objectiveId, { onSuccess: () => onDeleted?.() });
    }
  }

  async function handleCopyId() {
    await copy(displayId || objectiveId);
  }

  async function handleCopyResume() {
    if (resumeCommand) await copyResume(resumeCommand);
  }

  async function handleCopySession() {
    if (sessionId) await copySession(sessionId);
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Objective options"
          title="Objective options"
          className={cn(
            'flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50',
            triggerClassName
          )}
          onClick={event => event.stopPropagation()}
        >
          <MoreVertical className="h-4 w-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="min-w-[160px]"
          onClick={event => event.stopPropagation()}
        >
          {run ? (
            <DropdownMenuItem
              className="items-start gap-2 text-xs"
              disabled={runDisabled}
              title={run.disabledReason ?? undefined}
              onClick={run.onRun}
            >
              {run.pending ? (
                <Loader2 className="mt-px h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play
                  className={cn(
                    'mt-px h-3.5 w-3.5',
                    !runDisabled && 'fill-current text-emerald-600 dark:text-emerald-400'
                  )}
                />
              )}
              <span className="flex min-w-0 flex-col">
                <span className={cn(!runDisabled && 'text-emerald-600 dark:text-emerald-400')}>
                  {run.label}
                </span>
                {run.disabledReason ? (
                  <span className="max-w-[220px] text-[11px] text-muted-foreground">
                    {run.disabledReason}
                  </span>
                ) : null}
              </span>
            </DropdownMenuItem>
          ) : null}
          {resource && resourceOptions ? (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger
                className="gap-2 text-xs"
                disabled={resource.disabled}
                aria-label={`Resource: ${resourceOptions.currentLabel}`}
              >
                <FolderOpen className="h-3.5 w-3.5" />
                <span className="min-w-0 truncate">
                  Resource
                  <span className="text-muted-foreground"> · {resourceOptions.currentLabel}</span>
                </span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="min-w-[180px]">
                <DropdownMenuRadioGroup
                  value={resourceOptions.effectiveKey}
                  onValueChange={(key: string) => {
                    if (key === resourceOptions.effectiveKey) return;
                    resource.onChange(key === resourceOptions.primaryKey ? null : key);
                  }}
                >
                  {resourceOptions.choices.map(choice => (
                    <DropdownMenuRadioItem key={choice.key} value={choice.key} className="text-xs">
                      <span className="truncate">{choice.label}</span>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ) : null}
          {run || (resource && resourceOptions) ? <DropdownMenuSeparator /> : null}
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
          {sessionId ? (
            <DropdownMenuItem className="gap-2 text-xs" onClick={handleCopySession}>
              {sessionCopied ? (
                <Check className="h-3.5 w-3.5 text-green-600" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              Copy session ID
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          {onEditTitle ? (
            <DropdownMenuItem className="gap-2 text-xs" onClick={onEditTitle}>
              <Pencil className="h-3.5 w-3.5" />
              Edit title
            </DropdownMenuItem>
          ) : null}
          {onEditTitle ? <DropdownMenuSeparator /> : null}
          {canShowMove ? (
            <>
              {onMoveUp ? (
                <DropdownMenuItem className="gap-2 text-xs" onClick={onMoveUp}>
                  <ArrowUp className="h-3.5 w-3.5" />
                  Move up
                </DropdownMenuItem>
              ) : null}
              {onMoveDown ? (
                <DropdownMenuItem className="gap-2 text-xs" onClick={onMoveDown}>
                  <ArrowDown className="h-3.5 w-3.5" />
                  Move down
                </DropdownMenuItem>
              ) : null}
            </>
          ) : null}
          {onOpenAddToQueue ? (
            <DropdownMenuItem className="gap-2 text-xs" onClick={onOpenAddToQueue}>
              <ListOrdered className="h-3.5 w-3.5" />
              Add to queue…
            </DropdownMenuItem>
          ) : null}
          {canShowMove || canShowQueue ? <DropdownMenuSeparator /> : null}
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
          {canShowMarkComplete || canShowMarkDraft ? <DropdownMenuSeparator /> : null}
          {canShowForceDisconnect ? (
            <>
              <DropdownMenuItem
                className="gap-2 text-xs"
                variant="destructive"
                disabled={pending}
                onClick={() => setConfirmForceDisconnectOpen(true)}
              >
                <Unplug className="h-3.5 w-3.5" />
                Force disconnect
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
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
        <DialogContent onClick={event => event.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>Disconnect this executing objective?</DialogTitle>
            <DialogDescription>
              Moving an executing objective to Draft ends its active session and clears its pending
              launch. It returns to the top of the draft queue. Its deliveries, file changes, and
              terminal session are kept as previous runs.
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
      <Dialog open={confirmForceDisconnectOpen} onOpenChange={setConfirmForceDisconnectOpen}>
        <DialogContent onClick={event => event.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>Force disconnect this objective?</DialogTitle>
            <DialogDescription>
              This ends Overlord&apos;s active session and clears its pending launch. The objective
              returns to the top of the draft queue. Its deliveries, file changes, and terminal
              session are kept as previous runs.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirmForceDisconnectOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() => void confirmForceDisconnect()}
            >
              {update.isPending ? 'Disconnecting…' : 'Force disconnect'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={confirmReopenOpen} onOpenChange={setConfirmReopenOpen}>
        <DialogContent onClick={event => event.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>Mark this objective as draft?</DialogTitle>
            <DialogDescription>
              Returns this objective to Draft so it can be edited and run again. Its deliveries,
              file changes, and terminal session are kept as previous runs.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirmReopenOpen(false)}>
              Cancel
            </Button>
            <Button disabled={pending} onClick={() => void confirmReopen()}>
              {update.isPending ? 'Reopening…' : 'Mark draft'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
