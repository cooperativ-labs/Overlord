import { Check, CheckCircle2, ChevronDown, Copy, Loader2, MoreVertical, Play } from 'lucide-react';
import { useState } from 'react';

import type { ExecutionRequestDto, ObjectiveDto } from '../../../shared/contract.ts';
import { api } from '../../lib/api.ts';
import { useCopyToClipboard } from '../../lib/hooks/use-copy-to-clipboard.ts';
import { objectiveResourceConnection } from '../../lib/project-resources.ts';
import {
  useEnqueueRunQueueEntry,
  useLaunchObjective,
  useProjectExecutionTarget,
  useProjectResources,
  useProjectRunQueues,
  useUpdateObjective
} from '../../lib/queries.ts';
import { cn } from '../../lib/utils.ts';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '../ui/dropdown-menu.tsx';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover.tsx';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip.tsx';

import { type AgentModelSelection, MANUAL_AGENT_KEY } from './AgentModelSelector.tsx';

type AgentLaunchButtonSize = 'sm' | 'default';

type AgentLaunchButtonProps = {
  objective: ObjectiveDto;
  selection: AgentModelSelection;
  /** False until catalog + preference queries resolve; Run stays disabled. */
  selectionLoaded: boolean;
  /** True when another objective on the mission is already executing/launching. */
  hasActiveSibling?: boolean;
  /** Objective id for the active sibling job, when {@link hasActiveSibling} is true. */
  activeSiblingId?: string | null;
  /** Active execution request already queued for this objective, if any. */
  activeRequest?: ExecutionRequestDto | null;
  size?: AgentLaunchButtonSize;
};

const sizeStyles: Record<
  AgentLaunchButtonSize,
  { runButton: string; caretButton: string; label: string; icon: string; chevron: string }
> = {
  sm: {
    runButton: 'h-8 px-3 text-xs font-medium',
    caretButton: 'h-8 px-1.5',
    label: 'text-xs',
    icon: 'h-3.5 w-3.5',
    chevron: 'h-3.5 w-3.5'
  },
  default: {
    runButton: 'h-9 px-4 text-sm font-medium',
    caretButton: 'h-9 px-2',
    label: 'text-sm',
    icon: 'h-3.5 w-3.5',
    chevron: 'h-3.5 w-3.5'
  }
};

/**
 * Split run button for an objective: the primary action queues an execution
 * request for the selected agent/model; the caret offers Run, a copyable prompt
 * for driving an agent manually, and a paste-ready `ovld launch` command. When the manual pseudo-agent is
 * selected, the run affordance is replaced with a Complete button that marks
 * the objective complete. Mirrors the legacy AgentSplitButton: confirm-before-
 * queue when an agent is already working the mission, and a disabled-state
 * tooltip explaining what is missing. Direct Run always remains a separate
 * Delegator path from the project Run Queue.
 */
export function AgentLaunchButton({
  objective,
  selection,
  selectionLoaded,
  hasActiveSibling = false,
  activeSiblingId = null,
  activeRequest = null,
  size = 'sm'
}: AgentLaunchButtonProps) {
  const launch = useLaunchObjective();
  const updateObjective = useUpdateObjective();
  const resourcesQ = useProjectResources(objective.projectId);
  const executionTargetQ = useProjectExecutionTarget(objective.projectId);
  const runQueuesQ = useProjectRunQueues(objective.projectId);
  const enqueue = useEnqueueRunQueueEntry(objective.projectId);
  const [showActiveConfirm, setShowActiveConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [executionTargetId, setExecutionTargetId] = useState<string>('');
  const { copied: promptCopied, copy: copyPromptText } = useCopyToClipboard();
  const { copied: cliCopied, copy: copyCliText } = useCopyToClipboard();

  const primaryConnection = objectiveResourceConnection({
    resources: resourcesQ.data ?? [],
    resourceKey: objective.resourceKey,
    executionTargetId: executionTargetQ.data?.selectedExecutionTargetId ?? null
  });
  const isQueued = Boolean(activeRequest);
  const isLaunching = launch.isPending || updateObjective.isPending;
  const isManual = selection.agent === MANUAL_AGENT_KEY;
  // Blank draft slots can exist for inline authoring — they must not be launched
  // until an instruction has been written.
  const hasInstruction = objective.instructionText.trim().length > 0;
  // Queuing can fail silently, leaving an objective marked queued without a
  // runner ever picking it up. Keep the button enabled while queued so the user
  // can re-launch; only an in-flight request (isLaunching) blocks a re-click.
  const isDisabled =
    !selectionLoaded || isLaunching || !primaryConnection.connected || !hasInstruction;
  const styles = sizeStyles[size];

  function queueLaunch() {
    if (isManual) {
      setError('Please select an agent to launch this task');
      return;
    }
    if (!primaryConnection.connected) {
      setError(primaryConnection.message);
      return;
    }
    setError(null);
    launch.mutate(
      {
        id: objective.id,
        body: {
          agent: selection.agent,
          model: selection.model,
          reasoningEffort: selection.reasoningEffort,
          executionTargetId: executionTargetId || undefined
        }
      },
      { onError: err => setError(err instanceof Error ? err.message : 'Failed to queue execution') }
    );
  }

  function queueAfterActiveSibling() {
    setError(null);
    const queue = runQueuesQ.data?.queues.find(item => item.isDefault);
    if (!queue) {
      setError('The default Run Queue is not available yet');
      return;
    }
    enqueue.mutate(
      { objectiveId: objective.id, queueId: queue.id },
      {
        onError: err =>
          setError(err instanceof Error ? err.message : 'Failed to add to the Run Queue')
      }
    );
  }

  function disconnectActiveSiblingAndLaunch() {
    if (!activeSiblingId) {
      setShowActiveConfirm(false);
      queueLaunch();
      return;
    }
    setError(null);
    updateObjective.mutate(
      { id: activeSiblingId, body: { state: 'submitted' } },
      {
        onSuccess: () => {
          setShowActiveConfirm(false);
          queueLaunch();
        },
        onError: err =>
          setError(err instanceof Error ? err.message : 'Failed to disconnect current job')
      }
    );
  }

  function handleComplete() {
    if (updateObjective.isPending) return;
    setError(null);
    updateObjective.mutate(
      { id: objective.id, body: { state: 'complete' } },
      {
        onError: err =>
          setError(err instanceof Error ? err.message : 'Failed to mark objective complete')
      }
    );
  }

  function handleRun() {
    if (isDisabled) return;
    if (hasActiveSibling) {
      setShowActiveConfirm(true);
      return;
    }
    queueLaunch();
  }

  async function handleCopyPrompt() {
    setError(null);
    try {
      const { prompt } = await api.getObjectivePrompt(objective.id);
      await copyPromptText(prompt);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to copy prompt');
    }
  }

  async function handleCopyCliCommand() {
    if (isManual) return;
    setError(null);
    try {
      const { command } = await api.getObjectiveLaunchCommand({
        id: objective.id,
        agent: selection.agent,
        model: selection.model,
        reasoningEffort: selection.reasoningEffort,
        executionTargetId: executionTargetId || null
      });
      await copyCliText(command);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to copy CLI command');
    }
  }

  const runButton = (
    <button
      type="button"
      className={cn(
        'inline-flex cursor-pointer items-center gap-1.5 rounded-l-md transition-colors',
        'hover:bg-accent hover:text-accent-foreground',
        styles.runButton,
        isDisabled && 'cursor-not-allowed opacity-60'
      )}
      onClick={handleRun}
      disabled={isDisabled}
    >
      {isLaunching ? (
        <Loader2 className={cn(styles.icon, 'animate-spin')} />
      ) : isQueued ? (
        <Check className={cn(styles.icon, 'text-sky-500')} />
      ) : (
        <Play className={styles.icon} />
      )}
      <span
        className={cn(
          'whitespace-nowrap transition-colors',
          styles.label,
          isQueued && 'text-sky-600 dark:text-sky-400'
        )}
      >
        {isQueued ? 'Queued' : 'Run'}
      </span>
    </button>
  );

  const runButtonWrapped = hasActiveSibling ? (
    <Popover open={showActiveConfirm} onOpenChange={setShowActiveConfirm}>
      <PopoverTrigger render={<span className="inline-flex">{runButton}</span>} />
      <PopoverContent side="top" className="w-80 p-3 text-sm">
        <p className="mb-3 text-foreground">
          An agent appears to be working this mission already. Add this objective to the Run Queue
          so it launches after the current work completes?
        </p>
        <div className="flex items-center justify-end gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger
              className="inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50"
              aria-label="More launch options"
              title="More launch options"
            >
              <MoreVertical className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[200px]">
              <DropdownMenuItem
                className="gap-2 text-xs"
                disabled={isLaunching}
                onClick={disconnectActiveSiblingAndLaunch}
              >
                <span>Disconnect current job</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <button
            type="button"
            className="rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent"
            onClick={() => setShowActiveConfirm(false)}
          >
            Cancel
          </button>
          <button
            type="button"
            className="rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent"
            onClick={() => {
              setShowActiveConfirm(false);
              queueLaunch();
            }}
          >
            Run now
          </button>
          <button
            type="button"
            className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90"
            onClick={() => {
              setShowActiveConfirm(false);
              queueAfterActiveSibling();
            }}
          >
            Add to queue
          </button>
        </div>
      </PopoverContent>
    </Popover>
  ) : (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className={cn('inline-flex', isDisabled && 'cursor-not-allowed')}>{runButton}</span>
        }
      />
      <TooltipContent
        side="top"
        hidden={!isDisabled || (primaryConnection.connected && hasInstruction)}
      >
        {!hasInstruction
          ? 'Write an instruction before launching.'
          : !selectionLoaded
            ? 'Loading your agent model selection.'
            : !primaryConnection.connected
              ? primaryConnection.message
              : 'Queueing…'}
      </TooltipContent>
    </Tooltip>
  );

  if (isManual) {
    const isCompleting = updateObjective.isPending;
    return (
      <div className="relative shrink-0">
        <button
          type="button"
          className={cn(
            'inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-input bg-background px-3 text-xs font-medium shadow-sm transition-colors',
            'hover:bg-accent hover:text-accent-foreground',
            styles.runButton,
            isCompleting && 'cursor-not-allowed opacity-60'
          )}
          onClick={handleComplete}
          disabled={isCompleting}
        >
          {isCompleting ? (
            <Loader2 className={cn(styles.icon, 'animate-spin')} />
          ) : (
            <CheckCircle2 className={styles.icon} />
          )}
          <span className={cn('whitespace-nowrap', styles.label)}>Complete</span>
        </button>
        {error ? (
          <p className="absolute top-full right-0 z-10 mt-1 max-w-[260px] text-right text-[11px] text-red-400">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="relative shrink-0">
      {/* {!primaryConnection.connected && selectionLoaded ? (
        <div
          role="alert"
          className="absolute bottom-full right-0 z-10 mb-1.5 flex w-80 items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-200/90 px-3 py-2.5 text-left text-xs text-amber-800 shadow-md backdrop-blur-lg dark:bg-amber-950/80 dark:text-amber-300"
        >
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <p>{primaryConnection.message}</p>
        </div>
      ) : null} */}
      <div
        className={cn(
          'inline-flex shrink-0 items-stretch rounded-md border border-input bg-background text-sm shadow-sm transition-all',
          !isDisabled && 'hover:bg-accent hover:text-accent-foreground',
          isQueued && 'border-sky-400/60 ring-1 ring-sky-400/40'
        )}
      >
        {runButtonWrapped}

        <DropdownMenu>
          <DropdownMenuTrigger
            className={cn(
              'inline-flex items-center rounded-r-md border-l transition-colors',

              styles.caretButton
            )}
          >
            <ChevronDown className={cn(styles.chevron, 'text-muted-foreground')} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[180px]">
            <DropdownMenuItem className="gap-2 text-xs" onClick={handleRun} disabled={isDisabled}>
              <Play className="h-3.5 w-3.5" />
              <span>Run</span>
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-2 text-xs" onClick={() => void handleCopyPrompt()}>
              <Copy className="h-3.5 w-3.5" />
              <span>{promptCopied ? 'Copied ✓' : 'Copy prompt'}</span>
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-2 text-xs" onClick={() => void handleCopyCliCommand()}>
              <Copy className="h-3.5 w-3.5" />
              <span>{cliCopied ? 'Copied ✓' : 'Copy CLI command'}</span>
            </DropdownMenuItem>
            <div className="border-t px-2 py-2">
              <label
                className="mb-1 block text-[11px] text-muted-foreground"
                htmlFor={`execution-target-${objective.id}`}
              >
                Run on target
              </label>
              <select
                id={`execution-target-${objective.id}`}
                className="h-8 w-full rounded border bg-background px-1 text-xs"
                value={executionTargetId}
                onChange={event => setExecutionTargetId(event.target.value)}
              >
                <option value="">Project default</option>
                {(executionTargetQ.data?.eligibleTargets ?? [])
                  .filter(target => target.reachable && target.primaryResourceConnected)
                  .map(target => (
                    <option key={target.executionTargetId} value={target.executionTargetId}>
                      {target.label}
                    </option>
                  ))}
              </select>
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {error ? (
        <p className="absolute top-full right-0 z-10 mt-1 max-w-[260px] text-right text-[11px] text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}
