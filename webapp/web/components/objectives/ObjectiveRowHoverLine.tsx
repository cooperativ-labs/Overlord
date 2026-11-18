import type { MissionDetailDto, ObjectiveDto } from '@overlord/contract';
import {
  type FocusEvent,
  type PointerEvent,
  type SyntheticEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore
} from 'react';

import { useProjectResources, useUpdateObjective } from '../../lib/queries.ts';
import { cn } from '../../lib/utils.ts';

import { AgentLaunchButton } from './AgentLaunchButton.tsx';
import { AgentModelChooserButton } from './AgentModelChooserButton.tsx';
import { resolveLaunchSiblingGuard } from './launch-sibling-guard.ts';
import { ObjectiveResourcePicker } from './ObjectiveResourcePicker.tsx';
import type { useObjectiveAgentSelection } from './useObjectiveAgentSelection.ts';

/** Delay before the line closes once nothing holds it open, so passing pointers do not jump the list. */
export const OBJECTIVE_ROW_LINE_CLOSE_DELAY_MS = 150;

/** The agent selection one not-started row shares between its icon, menu Run and hover line. */
export type ObjectiveRowAgentSelection = ReturnType<typeof useObjectiveAgentSelection>;

const NO_HOVER_QUERY = '(hover: none)';

function subscribeNoHover(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const query = window.matchMedia(NO_HOVER_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

function readCanHover(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  return !window.matchMedia(NO_HOVER_QUERY).matches;
}

/** False on touch devices (`hover: none`): they use the row menu instead of the hover line. */
function useCanHover(): boolean {
  return useSyncExternalStore(subscribeNoHover, readCanHover, () => true);
}

/** Keyboard focus only: a click that focuses a control must not pin the line open. */
function isKeyboardFocus(target: EventTarget): boolean {
  if (!(target instanceof Element)) return false;
  try {
    return target.matches(':focus-visible');
  } catch {
    // An environment without :focus-visible support treats any focus as keyboard focus.
    return true;
  }
}

export type ObjectiveRowHoverLineState = {
  /** The line is shown (or still closing within its delay). */
  open: boolean;
  /** The line has opened at least once; its controls stay mounted from then on. */
  mounted: boolean;
  /** Spread on the row `<li>`. */
  rowProps: {
    onPointerEnter: (event: PointerEvent<HTMLElement>) => void;
    onPointerLeave: () => void;
    onFocus: (event: FocusEvent<HTMLElement>) => void;
    onBlur: (event: FocusEvent<HTMLElement>) => void;
  };
  /** The line's popups, launch or launch error hold it open (reported by the line). */
  setHeld: (held: boolean) => void;
};

/**
 * Open state of a not-started row's hover line (objective-row-hover-toolbar.md §2). The line
 * opens on pointer hover or keyboard focus within the row, and stays open while something holds
 * it (an open popup, a pending or failed launch). It closes {@link OBJECTIVE_ROW_LINE_CLOSE_DELAY_MS}
 * after nothing does. It never opens while disabled, while any row is dragged, or on devices
 * without hover, and it closes at once when one of those becomes true.
 */
export function useObjectiveRowHoverLine({
  enabled,
  dragging
}: {
  enabled: boolean;
  dragging: boolean;
}): ObjectiveRowHoverLineState {
  const canHover = useCanHover();
  const [pointerInside, setPointerInside] = useState(false);
  const [focusInside, setFocusInside] = useState(false);
  const [held, setHeldState] = useState(false);
  const [lingering, setLingering] = useState(false);
  const [mounted, setMounted] = useState(false);

  const allowed = enabled && canHover && !dragging;
  const wanted = allowed && (pointerInside || focusInside || held);

  // Start the close delay when the line stops being wanted (adjusted during render, not in an
  // effect, so the line never flickers closed for a frame).
  const [prevWanted, setPrevWanted] = useState(wanted);
  if (prevWanted !== wanted) {
    setPrevWanted(wanted);
    setLingering(!wanted && allowed);
  }
  useEffect(() => {
    if (!lingering) return;
    const timer = setTimeout(() => setLingering(false), OBJECTIVE_ROW_LINE_CLOSE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [lingering]);

  const open = wanted || (lingering && allowed);
  if (open && !mounted) setMounted(true);

  const setHeld = useCallback((next: boolean) => setHeldState(next), []);

  return {
    open,
    mounted,
    rowProps: {
      onPointerEnter: event => {
        if (event.pointerType === 'touch') return;
        setPointerInside(true);
      },
      onPointerLeave: () => setPointerInside(false),
      onFocus: event => {
        if (isKeyboardFocus(event.target)) setFocusInside(true);
      },
      onBlur: event => {
        const next = event.relatedTarget;
        if (next instanceof Node && event.currentTarget.contains(next)) return;
        setFocusInside(false);
      }
    },
    setHeld
  };
}

const stopPropagation = (event: SyntheticEvent) => event.stopPropagation();

type ObjectiveRowHoverLineProps = {
  open: boolean;
  objective: ObjectiveDto;
  mission: MissionDetailDto | null;
  agent: ObjectiveRowAgentSelection;
  /** Reports whether a popup, launch or launch error must keep the line open. */
  onHeldChange: (held: boolean) => void;
  /** Launch and resource errors, shown in the row's error slot. Null clears it. */
  onError: (message: string | null) => void;
};

/**
 * The second line of a not-started objective row (objective-row-hover-toolbar.md): resource,
 * agent/model, then — after a spacer — the split Run button. Run Queue and the identifier stay on
 * the first row. Run is inset from the right by the menu button and its gap (`pr-7.5`), so its
 * right edge lines up with the agent icon column above. It mirrors the composer toolbar so a
 * draft can be set up and run from the list.
 *
 * The reveal is the grid-rows pattern of `MissionCardHoverFooter`. While closed the line is
 * `inert`, so its controls are neither focusable nor announced. Every control stops pointerdown
 * and click propagation, so nothing here opens the detail or starts a drag.
 */
export function ObjectiveRowHoverLine({
  open,
  objective,
  mission,
  agent,
  onHeldChange,
  onError
}: ObjectiveRowHoverLineProps) {
  const resourcesQ = useProjectResources(objective.projectId);
  const updateObjective = useUpdateObjective();
  const [resourceOpen, setResourceOpen] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const [launchPopupOpen, setLaunchPopupOpen] = useState(false);
  const [launchPending, setLaunchPending] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);
  // The line mounts closed and opens a frame later, so its first reveal animates too.
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  const shown = open && entered;

  const held =
    resourceOpen || agentOpen || launchPopupOpen || launchPending || launchError !== null;
  const heldReportedRef = useRef(false);
  useEffect(() => {
    if (heldReportedRef.current === held) return;
    heldReportedRef.current = held;
    onHeldChange(held);
  }, [held, onHeldChange]);
  // A line unmounted while holding (the objective started) must not pin its row open.
  useEffect(() => () => onHeldChange(false), [onHeldChange]);

  const handleLaunchError = useCallback(
    (message: string | null) => {
      setLaunchError(message);
      onError(message);
    },
    [onError]
  );

  const resources = resourcesQ.data ?? [];
  const guard = mission
    ? resolveLaunchSiblingGuard({
        objective,
        siblings: mission.objectives,
        executionRequests: mission.executionRequests,
        allowParallelObjectives: mission.allowParallelObjectives,
        primaryResourceKey: resources.find(r => r.isPrimary)?.resourceKey ?? 'primary'
      })
    : null;

  return (
    <div
      className={cn(
        'relative z-[1] grid basis-full transition-[grid-template-rows,opacity] duration-150 ease-out motion-reduce:transition-none [@media(hover:none)]:hidden',
        shown ? 'grid-rows-[1fr] opacity-100' : 'pointer-events-none grid-rows-[0fr] opacity-0'
      )}
      inert={!shown}
      data-objective-row-line={shown ? 'open' : 'closed'}
      onClick={stopPropagation}
      onPointerDown={stopPropagation}
    >
      <div className="min-h-0 overflow-hidden">
        <div
          role="group"
          aria-label="Objective actions"
          className="flex min-w-0 items-center gap-1 pb-1.5 pl-9 pr-7.5"
        >
          <ObjectiveResourcePicker
            resources={resources}
            value={objective.resourceKey}
            disabled={updateObjective.isPending}
            onOpenChange={setResourceOpen}
            className="max-w-none shrink-0"
            labelClassName="max-w-[9rem] @max-[480px]/objective-list:max-w-[5rem]"
            onChange={resourceKey => {
              onError(null);
              updateObjective.mutate(
                { id: objective.id, body: { resourceKey } },
                {
                  onError: err =>
                    onError(err instanceof Error ? err.message : 'Failed to change the resource')
                }
              );
            }}
          />
          <AgentModelChooserButton
            fullLabel
            collapsibleClassName="@max-[480px]/objective-list:hidden"
            catalog={agent.catalog}
            selection={agent.selection}
            onChange={agent.setSelection}
            agentConfigs={agent.agentConfigs}
            onLaunchConfigCommit={agent.commitLaunchConfig}
            onUseInheritedDefault={agent.useInheritedLaunchConfig}
            launchConfigSourceHint={agent.launchConfigSourceHint}
            onOpenChange={setAgentOpen}
          />
          <span className="min-w-0 flex-1" aria-hidden="true" />
          <div className="shrink-0">
            <AgentLaunchButton
              objective={objective}
              selection={agent.selection}
              selectionLoaded={agent.loaded}
              hasActiveSibling={guard?.hasBlockingSibling ?? false}
              activeSiblingId={guard?.activeSiblingId ?? null}
              activeRequest={guard?.activeRequest ?? null}
              size="sm"
              onPopupOpenChange={setLaunchPopupOpen}
              onPendingChange={setLaunchPending}
              onErrorChange={handleLaunchError}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
