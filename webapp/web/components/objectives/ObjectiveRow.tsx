import type { MissionDetailDto, ObjectiveDto, ObjectiveState } from '@overlord/contract';
import { User } from 'lucide-react';
import {
  type ComponentProps,
  type CSSProperties,
  type HTMLAttributes,
  type MouseEvent,
  type Ref,
  useRef,
  useState
} from 'react';

import { getAgentIcon } from '../../lib/helpers/agent-icons.ts';
import { buildAgentResumeCommand } from '../../lib/helpers/agent-resume-command.ts';
import { useCopyToClipboard } from '../../lib/hooks/use-copy-to-clipboard.ts';
import {
  useAgentCatalog,
  useProject,
  useProjectResources,
  useUpdateObjective
} from '../../lib/queries.ts';
import { cn } from '../../lib/utils.ts';
import { KANBAN_TOUCH_DRAGGABLE_CLASS } from '../../pages/kanban-dnd.ts';
import { ExecutingShimmer } from '../StatusMotion.tsx';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip.tsx';

import { AgentIcon } from './AgentIcon.tsx';
import { AgentModelChooserButton } from './AgentModelChooserButton.tsx';
import { ObjectiveMenuButton } from './ObjectiveMenuButton.tsx';
import { ObjectiveQueuePopover } from './ObjectiveQueuePopover.tsx';
import { ObjectiveStateIcon } from './ObjectiveStateIcon.tsx';
import { useObjectiveAgentSelection } from './useObjectiveAgentSelection.ts';
import { useObjectiveQuickRun } from './useObjectiveQuickRun.ts';

/** Not started: the reorderable set (plan §3.3). */
export function isNotStartedObjective(state: ObjectiveState): boolean {
  return state === 'draft' || state === 'submitted';
}

export function isInFlightObjective(state: ObjectiveState): boolean {
  return state === 'executing' || state === 'pending_delivery';
}

/** States whose menu offers "Add to queue…" when the objective has no queue entry. */
const ADD_TO_QUEUE_STATES: ObjectiveState[] = [
  'draft',
  'submitted',
  'launching',
  'executing',
  'pending_delivery'
];

/** The row's title: the objective title, else its first instruction line, else a placeholder. */
export function objectiveRowTitle(objective: Pick<ObjectiveDto, 'title' | 'instructionText'>) {
  const title = objective.title?.trim();
  if (title) return title;
  const firstLine = objective.instructionText
    .split('\n')
    .map(line => line.trim())
    .find(line => line.length > 0);
  return firstLine ?? 'Untitled objective';
}

/** The short key after the last `.` of a display id (`coo:1107.v8qc` → `v8qc`). */
export function objectiveShortKey(displayId: string): string {
  return displayId.split('.').pop() ?? displayId;
}

/** Native tooltip on the title: what the objective is doing and since when. */
export function objectiveRowTimestampTitle(objective: ObjectiveDto): string {
  const at = (iso: string | null) => new Date(iso ?? objective.updatedAt).toLocaleString();
  switch (objective.state) {
    case 'complete':
      return `Completed ${at(objective.completedAt)}`;
    case 'executing':
      return `Executing since ${at(objective.startedAt)}`;
    case 'pending_delivery':
      return `Pending delivery since ${at(objective.startedAt)}`;
    case 'launching':
      return `Launching since ${at(objective.launchedAt)}`;
    default:
      return `Created ${at(objective.createdAt)}`;
  }
}

/** Props the sortable wrapper hands the row; only not-started rows receive them. */
export type ObjectiveRowDragProps = {
  setNodeRef: (node: HTMLElement | null) => void;
  /** Pointer/touch listeners for the row button. Keyboard dragging is intentionally absent. */
  listeners: HTMLAttributes<HTMLElement> | undefined;
  style: CSSProperties;
  isDragging: boolean;
};

export type ObjectiveRowProps = {
  objective: ObjectiveDto;
  /**
   * The objective's mission. Not-started rows use it for the menu's Run, which applies the same
   * parallel-launch guard as the Run button.
   */
  mission?: MissionDetailDto | null;
  /** In flight with at least one open question or choice. */
  blocked?: boolean;
  /** This objective's detail is open. */
  selected?: boolean;
  /** Open the objective detail. `trigger` is the row button, for focus return. */
  onOpen: (objective: ObjectiveDto, options: { trigger: HTMLElement | null }) => void;
  /** Open the detail with the title in edit mode. */
  onEditTitle?: (objective: ObjectiveDto) => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  /** The objective was deleted (close its detail when open). */
  onDeleted?: (objective: ObjectiveDto) => void;
  drag?: ObjectiveRowDragProps;
  /** Ref to the row button, for hosts that return focus to it. */
  buttonRef?: Ref<HTMLButtonElement>;
};

/**
 * One objective in the mission panel's compact list (plan §7.2): state icon and title inside an
 * invisible row button that opens the objective detail (and, when not started, reorders on
 * press-and-hold), then sibling controls — Run Queue, identifier copy, agent, menu (with Run and
 * Resource while not started). The
 * controls are siblings of the row button, never children, so nothing interactive nests, and
 * each stops propagation so it never opens the detail.
 */
export function ObjectiveRow({
  objective,
  mission = null,
  blocked = false,
  selected = false,
  onOpen,
  onEditTitle,
  onMoveUp,
  onMoveDown,
  onDeleted,
  drag,
  buttonRef
}: ObjectiveRowProps) {
  const rowRef = useRef<HTMLLIElement | null>(null);
  const localButtonRef = useRef<HTMLButtonElement | null>(null);
  const [queueOpen, setQueueOpen] = useState(false);
  /** Opened from the menu: anchor to the row, since the queue icon may be hidden or absent. */
  const [queueFromMenu, setQueueFromMenu] = useState(false);
  const { copied, copy } = useCopyToClipboard({ resetMs: 1200 });
  /** A Run or resource change from the menu failed. Shown under the row until the next try. */
  const [menuError, setMenuError] = useState<string | null>(null);

  const notStarted = isNotStartedObjective(objective.state);
  const inFlight = isInFlightObjective(objective.state);
  const isBlocked = blocked && inFlight;
  const queueEntry = objective.queueEntry ?? null;
  const fullId = objective.displayId || objective.id;
  const title = objectiveRowTitle(objective);
  const resumeCommand = buildAgentResumeCommand({
    agent: objective.assignedAgent,
    sessionId: objective.externalSessionId
  });
  const canAddToQueue = queueEntry === null && ADD_TO_QUEUE_STATES.includes(objective.state);
  /** Queued: always. Not started and not queued: on hover/focus. Otherwise: no button. */
  const queueTrigger: 'always' | 'hover' | 'none' = queueEntry
    ? 'always'
    : notStarted
      ? 'hover'
      : 'none';

  const open = () => onOpen(objective, { trigger: localButtonRef.current });
  const openQueueFromMenu = () => {
    // Let the menu finish closing first, so its dismissal does not count as an outside press
    // on the popover that is opening.
    setTimeout(() => {
      setQueueFromMenu(true);
      setQueueOpen(true);
    }, 0);
  };
  const setRowRef = (node: HTMLLIElement | null) => {
    rowRef.current = node;
    drag?.setNodeRef(node);
  };
  const setButtonRef = (node: HTMLButtonElement | null) => {
    localButtonRef.current = node;
    if (typeof buttonRef === 'function') buttonRef(node);
    else if (buttonRef) (buttonRef as { current: HTMLButtonElement | null }).current = node;
  };

  const menuProps: ComponentProps<typeof ObjectiveMenuButton> = {
    objectiveId: objective.id,
    displayId: objective.displayId,
    state: objective.state,
    resumeCommand,
    sessionId: objective.externalSessionId,
    onEditTitle: onEditTitle ? () => onEditTitle(objective) : undefined,
    onMoveUp: notStarted ? onMoveUp : undefined,
    onMoveDown: notStarted ? onMoveDown : undefined,
    onOpenAddToQueue: canAddToQueue ? openQueueFromMenu : undefined,
    showForceDisconnect: true,
    onDeleted: onDeleted ? () => onDeleted(objective) : undefined
  };

  return (
    <li
      ref={setRowRef}
      style={drag?.style}
      data-objective-id={objective.id}
      data-objective-ref={objective.displayId || objective.id}
      data-blocked={isBlocked ? 'true' : undefined}
      className={cn(
        'group/row relative flex min-h-9 min-w-0 flex-wrap items-center gap-x-1 overflow-hidden pr-2 transition-colors',
        isBlocked && 'bg-yellow-300/60 dark:bg-yellow-400/25',
        !isBlocked && selected && 'bg-muted',
        !isBlocked && !selected && 'hover:bg-muted/40',
        drag?.isDragging &&
          'z-10 rounded-md bg-(--color-surface-1) shadow-lg outline outline-(--color-border)'
      )}
    >
      {inFlight && !isBlocked ? <ExecutingShimmer /> : null}
      <button
        ref={setButtonRef}
        type="button"
        className={cn(
          'relative z-[1] flex min-h-9 min-w-0 flex-1 items-center gap-2 py-1.5 pl-3 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50',
          notStarted && KANBAN_TOUCH_DRAGGABLE_CLASS,
          notStarted && drag && 'cursor-pointer active:cursor-grabbing'
        )}
        title={notStarted ? 'Click to open. Hold and drag to reorder.' : 'Click to open'}
        aria-current={selected ? 'true' : undefined}
        {...(notStarted ? drag?.listeners : undefined)}
        onClick={(event: MouseEvent<HTMLButtonElement>) => {
          event.stopPropagation();
          open();
        }}
      >
        <ObjectiveStateIcon state={objective.state} blocked={isBlocked} />
        <span
          className={cn(
            'min-w-0 flex-1 truncate',
            objective.state === 'complete' ? 'text-(--color-ink-dim)' : 'text-(--color-ink)',
            inFlight && 'font-medium'
          )}
          title={objectiveRowTimestampTitle(objective)}
        >
          {title}
        </span>
      </button>

      <div className="relative z-[1] flex shrink-0 items-center gap-0.5">
        {queueTrigger !== 'none' || queueOpen ? (
          <ObjectiveQueuePopover
            objective={objective}
            open={queueOpen}
            onOpenChange={next => {
              setQueueOpen(next);
              if (!next) setQueueFromMenu(false);
            }}
            showTrigger={queueTrigger !== 'none'}
            anchor={queueFromMenu || queueTrigger === 'none' ? rowRef : undefined}
            triggerClassName={cn(
              'h-7 w-7 justify-center px-0',
              queueTrigger === 'hover' &&
                'opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100 focus-visible:opacity-100 data-[popup-open]:opacity-100 data-[queue-pending=true]:opacity-100 [@media(hover:none)]:hidden'
            )}
          />
        ) : null}

        {objective.displayId ? (
          <button
            type="button"
            className={cn(
              'inline-flex h-7 min-w-[3.25rem] items-center justify-center rounded-md px-1 font-mono text-[11px] transition-colors hover:bg-muted/60',
              copied ? 'text-emerald-600 dark:text-emerald-400' : 'text-(--color-ink-dim)'
            )}
            aria-label={`Copy ${fullId}`}
            title={`Copy ${fullId}`}
            onPointerDown={event => event.stopPropagation()}
            onClick={event => {
              event.stopPropagation();
              void copy(fullId);
            }}
          >
            {copied ? 'Copied' : objectiveShortKey(objective.displayId)}
          </button>
        ) : null}

        {notStarted ? (
          <NotStartedRowTail
            objective={objective}
            mission={mission}
            menuProps={menuProps}
            onMenuError={setMenuError}
          />
        ) : (
          <>
            <RowAgentStatic objective={objective} />
            <ObjectiveMenuButton {...menuProps} />
          </>
        )}
      </div>
      {menuError ? (
        <p
          role="alert"
          className="relative z-[1] basis-full truncate pb-1.5 pl-9 text-[11px] text-destructive"
          title={menuError}
        >
          {menuError}
        </p>
      ) : null}
    </li>
  );
}

/**
 * Not started: the agent icon opens the agent/model selector, and the menu adds Run and the
 * Resource submenu (coo:1289). Both share one agent selection, so Run launches with the agent the
 * icon shows.
 */
function NotStartedRowTail({
  objective,
  mission,
  menuProps,
  onMenuError
}: {
  objective: ObjectiveDto;
  mission: MissionDetailDto | null;
  menuProps: ComponentProps<typeof ObjectiveMenuButton>;
  onMenuError: (message: string | null) => void;
}) {
  const {
    catalog,
    agentConfigs,
    selection,
    setSelection,
    commitLaunchConfig,
    useInheritedLaunchConfig,
    launchConfigSourceHint,
    loaded
  } = useObjectiveAgentSelection(objective);
  const quickRun = useObjectiveQuickRun({
    objective,
    mission,
    selection,
    selectionLoaded: loaded,
    onError: onMenuError
  });
  const resourcesQ = useProjectResources(objective.projectId);
  const updateObjective = useUpdateObjective();

  return (
    <>
      <AgentModelChooserButton
        iconOnly
        catalog={catalog}
        selection={selection}
        onChange={setSelection}
        agentConfigs={agentConfigs}
        onLaunchConfigCommit={commitLaunchConfig}
        onUseInheritedDefault={useInheritedLaunchConfig}
        launchConfigSourceHint={launchConfigSourceHint}
      />
      <ObjectiveMenuButton
        {...menuProps}
        run={{
          label: quickRun.label,
          onRun: quickRun.run,
          disabledReason: quickRun.disabledReason,
          pending: quickRun.pending
        }}
        resource={{
          resources: resourcesQ.data ?? [],
          value: objective.resourceKey,
          disabled: updateObjective.isPending,
          onChange: resourceKey => {
            onMenuError(null);
            updateObjective.mutate(
              { id: objective.id, body: { resourceKey } },
              {
                onError: err =>
                  onMenuError(err instanceof Error ? err.message : 'Failed to change the resource')
              }
            );
          }
        }}
      />
    </>
  );
}

/** Launching, in flight, complete: a static icon with "<agent> · <model>" as its tooltip. */
function RowAgentStatic({ objective }: { objective: ObjectiveDto }) {
  // Labels come from the objective's own workspace's catalog (coo:324).
  const projectQuery = useProject(objective.projectId);
  const catalogQuery = useAgentCatalog(projectQuery.data?.workspaceId);
  const catalogAgent = catalogQuery.data?.agents.find(a => a.key === objective.assignedAgent);
  const catalogModel = catalogAgent?.models.find(m => m.id === objective.model);
  const agentLabel = catalogAgent?.label ?? objective.assignedAgent ?? 'Manual';
  const modelLabel = catalogModel?.displayName ?? objective.model;
  const tooltip = modelLabel ? `${agentLabel} · ${modelLabel}` : agentLabel;
  const hasIcon = objective.assignedAgent ? getAgentIcon(objective.assignedAgent) !== null : false;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className="inline-flex size-7 shrink-0 items-center justify-center"
            role="img"
            aria-label={tooltip}
          />
        }
      >
        {hasIcon && objective.assignedAgent ? (
          <AgentIcon
            agentKey={objective.assignedAgent}
            size={14}
            alt=""
            className="h-3.5 w-3.5 shrink-0"
          />
        ) : (
          <User className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        )}
      </TooltipTrigger>
      <TooltipContent side="top">{tooltip}</TooltipContent>
    </Tooltip>
  );
}
