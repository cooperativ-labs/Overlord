import type { ObjectiveDto, TerminalSessionDto } from '@overlord/contract';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, Monitor, SquareTerminal } from 'lucide-react';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState
} from 'react';

import {
  forgetAbsentLatchSession,
  isLatchSessionAbsentError,
  useLatchSessionInspection
} from '../lib/latch-session-client.ts';
import { selectLatchSessionDisplay } from '../lib/latch-session-display.ts';
import { useLaunchSettings } from '../lib/queries.ts';
import { cn } from '../lib/utils.ts';

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from './ui/accordion.tsx';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover.tsx';
import { LatchSessionActions } from './LatchSessionActions.tsx';

const stateTone: Record<TerminalSessionDto['lastObservedState'], string> = {
  running: 'bg-emerald-500',
  stopping: 'bg-amber-500',
  exited: 'bg-muted-foreground',
  lost: 'bg-destructive'
};

function sessionRowKey(session: TerminalSessionDto): string {
  return `${session.executionRequestId}:${session.providerSessionId}`;
}

export type ObjectiveSessionLabel = { displayId: string; title: string };

/**
 * How a Latch session identifies itself in the mission-level section.
 *
 * A session is an execution of one **objective** (coo:756 §9.2), so a card
 * drawn outside that objective's row has to name it. Sessions whose objective
 * has since been deleted fall back to the recorded Latch session name.
 */
function objectiveLabelFor(
  session: TerminalSessionDto,
  objectives: readonly ObjectiveDto[]
): ObjectiveSessionLabel | null {
  const objective = objectives.find(candidate => candidate.id === session.objectiveId);
  if (!objective?.displayId) return null;
  return { displayId: objective.displayId, title: objective.title?.trim() || 'Untitled objective' };
}

/**
 * Live view of one Latch session through its terminal reachability probe.
 *
 * Tracking is deliberately separate from rendering. The panel only ever draws
 * one full card; previous sessions sit collapsed inside the accordion. A
 * session that is still running has to keep reporting even while it is
 * collapsed — otherwise streamlining the display would silently stop detecting
 * a session Latch has reclaimed. Queries are keyed by provider session id, so a
 * tracked session that also gets rendered shares one poll rather than doubling
 * it.
 */
function useLatchSessionTracking({
  session,
  missionId,
  localExecutionTargetId,
  onAbsent
}: {
  session: TerminalSessionDto;
  missionId: string;
  localExecutionTargetId: string | null;
  onAbsent?: (providerSessionId: string) => void;
}) {
  const queryClient = useQueryClient();
  const onThisDevice =
    Boolean(localExecutionTargetId) && session.executionTargetId === localExecutionTargetId;
  const inspection = useLatchSessionInspection({ session, enabled: onThisDevice });
  const absent = isLatchSessionAbsentError(inspection.error);

  useEffect(() => {
    if (!absent) return;
    onAbsent?.(session.providerSessionId);
    void forgetAbsentLatchSession({ missionId, session, queryClient });
  }, [
    absent,
    missionId,
    onAbsent,
    queryClient,
    session,
    session.executionRequestId,
    session.providerSessionId
  ]);

  return {
    onThisDevice,
    inspection,
    absent,
    state: inspection.data?.state ?? session.lastObservedState,
    name: inspection.data?.name ?? session.sessionName,
    reachable: onThisDevice && inspection.isSuccess,
    checking: onThisDevice && inspection.isPending
  };
}

/**
 * Keeps a session that is not on screen under observation. Renders nothing:
 * the queries it starts are the whole point.
 */
function LatchSessionTracker({
  session,
  missionId,
  localExecutionTargetId,
  onAbsent
}: {
  session: TerminalSessionDto;
  missionId: string;
  localExecutionTargetId: string | null;
  onAbsent?: (providerSessionId: string) => void;
}) {
  useLatchSessionTracking({ session, missionId, localExecutionTargetId, onAbsent });
  return null;
}

/**
 * The full controls for the current Latch session. Borderless: the popover it
 * renders in is already the card (coo:1303).
 */
function TerminalSessionCard({
  missionId,
  session,
  objectiveLabel,
  localExecutionTargetId,
  onAbsent,
  footer
}: {
  missionId: string;
  session: TerminalSessionDto;
  /** Set only in the mission-level section, where the card is not inside its objective's row. */
  objectiveLabel?: ObjectiveSessionLabel | null;
  localExecutionTargetId: string | null;
  onAbsent?: (providerSessionId: string) => void;
  /** Rendered inside the card, below its own controls (the previous-sessions accordion). */
  footer?: ReactNode;
}) {
  const { inspection, absent, state, name, reachable, checking } = useLatchSessionTracking({
    session,
    missionId,
    localExecutionTargetId,
    onAbsent
  });

  if (absent) return null;

  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Monitor className="h-4 w-4 shrink-0 text-muted-foreground" />
            {objectiveLabel ? (
              <p className="min-w-0 truncate text-sm font-medium">
                <span className="font-mono text-[11px] text-muted-foreground">
                  {objectiveLabel.displayId}
                </span>{' '}
                {objectiveLabel.title}
              </p>
            ) : (
              <p className="truncate text-sm font-medium">{name}</p>
            )}
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            Latch · {session.deviceLabel ?? 'Unknown device'}
            {objectiveLabel ? ` · ${name}` : ''}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 text-xs capitalize text-muted-foreground">
          <span className={cn('h-2 w-2 rounded-full', stateTone[state])} />
          {state}
        </div>
      </div>

      {/* Only the problem states are worth a line; a reachable device needs no note. */}
      {reachable ? null : (
        <div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          {checking ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
          <span>
            {checking
              ? 'Checking device reachability…'
              : 'Device is not reachable from this client'}
          </span>
        </div>
      )}

      <LatchSessionActions
        session={session}
        name={name}
        state={state}
        reachable={reachable}
        layout="card"
        className="mt-3"
      />

      {inspection.isError ? (
        <p className="mt-2 text-xs text-destructive">
          {inspection.error?.message ?? 'Latch session action failed.'}
        </p>
      ) : null}

      {footer}
    </div>
  );
}

/** One line per exited or earlier session: enough to identify it and act on it, nothing more. */
function CompactSessionRow({
  missionId,
  session,
  objectiveLabel,
  localExecutionTargetId,
  onAbsent
}: {
  missionId: string;
  session: TerminalSessionDto;
  /** Set only in the mission-level section, where the row is not inside its objective's row. */
  objectiveLabel?: ObjectiveSessionLabel | null;
  localExecutionTargetId: string | null;
  onAbsent?: (providerSessionId: string) => void;
}) {
  const { state, name, reachable, absent } = useLatchSessionTracking({
    session,
    missionId,
    localExecutionTargetId,
    onAbsent
  });

  if (absent) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-border/60 bg-muted/30 px-2 py-1.5">
      <span className={cn('h-2 w-2 shrink-0 rounded-full', stateTone[state])} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium">
          {objectiveLabel ? (
            <>
              <span className="font-mono text-[10px] text-muted-foreground">
                {objectiveLabel.displayId}
              </span>{' '}
              {objectiveLabel.title}
            </>
          ) : (
            name
          )}
        </p>
        <p className="truncate text-[11px] capitalize text-muted-foreground">
          {state} · {session.deviceLabel ?? 'Unknown device'}
        </p>
      </div>
      <LatchSessionActions
        session={session}
        name={name}
        state={state}
        reachable={reachable}
        layout="inline"
      />
    </div>
  );
}

type LatchSessionContextValue = {
  missionId: string;
  localExecutionTargetId: string | null;
  onAbsent: (providerSessionId: string) => void;
  isAbsent: (providerSessionId: string) => boolean;
};

const LatchSessionContext = createContext<LatchSessionContextValue | null>(null);

function useLatchSessionContext(): LatchSessionContextValue {
  const value = useContext(LatchSessionContext);
  if (!value) {
    throw new Error('ObjectiveTerminalSessions must render inside MissionLatchSessionProvider');
  }
  return value;
}

/**
 * Mission-wide Latch bookkeeping for the mission panel (coo:879, coo:990).
 *
 * The full controls render once per mission in the {@link MissionLatchChip}
 * popover, and the objective detail keeps a minimal line — but a running
 * session must stay under observation whether or not either is on screen,
 * otherwise closing the popover would silently stop detecting a session Latch
 * has reclaimed. The provider mounts a
 * {@link LatchSessionTracker} for every running session on the mission
 * regardless of what is drawn; rendered cards share the same query keys, so an
 * expanded objective never doubles the polling. It also owns the set of
 * sessions the probe reported absent, so every renderer hides them together.
 */
export function MissionLatchSessionProvider({
  missionId,
  workspaceId,
  sessions,
  children
}: {
  missionId: string;
  workspaceId: string;
  sessions: readonly TerminalSessionDto[];
  children: ReactNode;
}) {
  const launchSettings = useLaunchSettings(workspaceId);
  const localExecutionTargetId = launchSettings.data?.executionTargetId ?? null;
  const [absentIds, setAbsentIds] = useState<ReadonlySet<string>>(() => new Set());
  const onAbsent = useCallback((providerSessionId: string) => {
    setAbsentIds(current => {
      if (current.has(providerSessionId)) return current;
      const next = new Set(current);
      next.add(providerSessionId);
      return next;
    });
  }, []);
  const isAbsent = useCallback(
    (providerSessionId: string) => absentIds.has(providerSessionId),
    [absentIds]
  );
  const value = useMemo<LatchSessionContextValue>(
    () => ({ missionId, localExecutionTargetId, onAbsent, isAbsent }),
    [isAbsent, localExecutionTargetId, missionId, onAbsent]
  );

  return (
    <LatchSessionContext.Provider value={value}>
      {children}
      {sessions
        .filter(
          session =>
            session.lastObservedState === 'running' && !absentIds.has(session.providerSessionId)
        )
        .map(session => (
          <LatchSessionTracker
            key={`tracker:${sessionRowKey(session)}`}
            missionId={missionId}
            session={session}
            localExecutionTargetId={localExecutionTargetId}
            onAbsent={onAbsent}
          />
        ))}
    </LatchSessionContext.Provider>
  );
}

/**
 * Previous Latch sessions, collapsed under the current card so a long-running
 * mission does not turn into a stack of widgets (coo:990). The trigger counts
 * other connections that are still running when any are; otherwise it counts
 * the previous sessions themselves.
 */
function PreviousLatchSessionsAccordion({
  sessions,
  runningOtherCount,
  objectives
}: {
  sessions: readonly TerminalSessionDto[];
  runningOtherCount: number;
  objectives: readonly ObjectiveDto[];
}) {
  const { missionId, localExecutionTargetId, onAbsent } = useLatchSessionContext();
  if (sessions.length === 0) return null;

  const liveTrigger = runningOtherCount > 0;
  const count = liveTrigger ? runningOtherCount : sessions.length;
  let label = 'previous sessions';
  if (liveTrigger) {
    label = count === 1 ? 'other Latch connection running' : 'other Latch connections running';
  } else if (count === 1) {
    label = 'previous session';
  }

  return (
    <Accordion className="mt-3 border-t border-border pt-1">
      <AccordionItem value="previous-latch-sessions" className="border-b-0">
        <AccordionTrigger className="py-2 text-xs font-medium text-muted-foreground hover:no-underline">
          <span className="flex items-center gap-2">
            <span
              className={cn(
                'inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold',
                liveTrigger
                  ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                  : 'bg-muted text-muted-foreground'
              )}
            >
              {count}
            </span>
            {label}
          </span>
        </AccordionTrigger>
        <AccordionContent className="[&_p:not(:last-child)]:mb-0">
          <div className="space-y-1.5">
            {sessions.map(session => (
              <CompactSessionRow
                key={sessionRowKey(session)}
                missionId={missionId}
                session={session}
                objectiveLabel={objectiveLabelFor(session, objectives)}
                localExecutionTargetId={localExecutionTargetId}
                onAbsent={onAbsent}
              />
            ))}
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

/** True when a press landed in a dialog (or its backdrop) opened from inside the popover. */
function isInsideNestedDialog(event: Event | undefined): boolean {
  const target = event?.target;
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest('[data-slot="dialog-content"], [data-slot="dialog-overlay"]'));
}

/**
 * The mission-wide Latch controls (coo:990), opened from {@link MissionLatchChip}
 * in the panel header (coo:1281 plan §10): the current session's full card
 * (open in a viewer, copy the attach command, end the session, reachability
 * and errors) with previous sessions collapsed beneath it. Each one names its
 * objective, since the card does not sit inside it.
 */
function MissionLatchSessionsContent({
  current,
  others,
  runningOtherCount,
  objectives
}: {
  current: TerminalSessionDto;
  others: readonly TerminalSessionDto[];
  runningOtherCount: number;
  objectives: readonly ObjectiveDto[];
}) {
  const { missionId, localExecutionTargetId, onAbsent } = useLatchSessionContext();
  return (
    <TerminalSessionCard
      missionId={missionId}
      session={current}
      objectiveLabel={objectiveLabelFor(current, objectives)}
      localExecutionTargetId={localExecutionTargetId}
      onAbsent={onAbsent}
      footer={
        others.length > 0 ? (
          <PreviousLatchSessionsAccordion
            sessions={others}
            runningOtherCount={runningOtherCount}
            objectives={objectives}
          />
        ) : null
      }
    />
  );
}

function MissionLatchChipButton({
  current,
  others,
  runningOtherCount,
  objectives
}: {
  current: TerminalSessionDto;
  others: readonly TerminalSessionDto[];
  runningOtherCount: number;
  objectives: readonly ObjectiveDto[];
}) {
  const { missionId, localExecutionTargetId, onAbsent } = useLatchSessionContext();
  // Shares the probe's query key with the card and the provider's tracker: no extra polling.
  const { state } = useLatchSessionTracking({
    session: current,
    missionId,
    localExecutionTargetId,
    onAbsent
  });
  const [open, setOpen] = useState(false);

  return (
    <Popover
      open={open}
      onOpenChange={(next, details) => {
        // The End session confirmation is a dialog opened from inside the popover; pressing
        // it must not dismiss the popover (which would unmount the confirmation).
        if (!next && details.reason === 'outside-press' && isInsideNestedDialog(details.event)) {
          return;
        }
        setOpen(next);
      }}
    >
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label={`Latch session, ${state}`}
            data-latch-chip=""
            className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-border bg-background px-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[popup-open]:bg-accent data-[popup-open]:text-foreground"
          />
        }
      >
        <span
          className={cn('h-2 w-2 shrink-0 rounded-full', stateTone[state])}
          aria-hidden="true"
        />
        <SquareTerminal className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        {/* The dot carries the state (coo:1303); narrow panels keep only the dot and the icon (plan §10). */}
        <span
          className="whitespace-nowrap @max-[480px]/mission-panel:hidden"
          data-latch-chip-label=""
        >
          Latch
        </span>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        aria-label="Latch terminal sessions"
        className="max-h-[min(32rem,calc(100dvh-6rem))] w-[min(24rem,calc(100vw-2rem))] overflow-y-auto p-3"
      >
        <MissionLatchSessionsContent
          current={current}
          others={others}
          runningOtherCount={runningOtherCount}
          objectives={objectives}
        />
      </PopoverContent>
    </Popover>
  );
}

/**
 * The header chip for the mission's current Latch session (coo:1281 plan §10).
 * Renders only when the mission has a current session, after the provider's
 * absent-session filtering. Tracking does not depend on the popover: the
 * provider keeps every running session under observation while it is closed.
 */
export function MissionLatchChip({
  sessions,
  objectives
}: {
  /** Every session on the mission, newest first. */
  sessions: readonly TerminalSessionDto[];
  /** The mission's objectives, used to label each session with what it ran. */
  objectives: readonly ObjectiveDto[];
}) {
  const { isAbsent } = useLatchSessionContext();
  const visible = sessions.filter(session => !isAbsent(session.providerSessionId));
  const { current, others, runningOtherCount } = selectLatchSessionDisplay(visible);
  if (!current) return null;
  return (
    <MissionLatchChipButton
      // A different current session starts from a closed popover and fresh tracking state.
      key={sessionRowKey(current)}
      current={current}
      others={others}
      runningOtherCount={runningOtherCount}
      objectives={objectives}
    />
  );
}

/**
 * One session inside its objective's detail: a status line over the minimal
 * {@link LatchSessionActions} (coo:1303).
 */
function ObjectiveSessionLine({
  session,
  missionId,
  localExecutionTargetId,
  onAbsent
}: {
  session: TerminalSessionDto;
  missionId: string;
  localExecutionTargetId: string | null;
  onAbsent?: (providerSessionId: string) => void;
}) {
  const { state, name, reachable, absent } = useLatchSessionTracking({
    session,
    missionId,
    localExecutionTargetId,
    onAbsent
  });

  if (absent) return null;

  return (
    <div className="grid min-w-0 gap-1.5">
      <div className="flex min-w-0 items-center gap-1.5">
        <span
          className={cn('h-2 w-2 shrink-0 rounded-full', stateTone[state])}
          aria-hidden="true"
        />
        <span className="truncate text-xs text-(--color-ink-dim)" title={name}>
          <span className="capitalize">{state}</span>
          {session.deviceLabel ? ` · ${session.deviceLabel}` : ''}
        </span>
      </div>
      <LatchSessionActions
        session={session}
        name={name}
        state={state}
        reachable={reachable}
        layout="minimal"
      />
    </div>
  );
}

/**
 * The Latch sessions one objective launched, rendered inside that objective's
 * detail. `sessions` must be newest first.
 *
 * Deliberately minimal (coo:990): the full card lives in the header
 * {@link MissionLatchChip} popover, so the objective detail keeps a status
 * line per session over the same three controls in their lighter `minimal`
 * layout (coo:1303).
 */
export function ObjectiveTerminalSessions({
  sessions,
  emptyState,
  heading
}: {
  sessions: readonly TerminalSessionDto[];
  /** Rendered when the objective launched no session (or every session was forgotten). */
  emptyState?: ReactNode;
  /** Rendered above the list only when at least one session is visible. */
  heading?: ReactNode;
}) {
  const { missionId, localExecutionTargetId, onAbsent, isAbsent } = useLatchSessionContext();
  const visible = sessions.filter(session => !isAbsent(session.providerSessionId));
  if (visible.length === 0) return <>{emptyState ?? null}</>;

  return (
    <>
      {heading}
      <div className="space-y-3">
        {visible.map(session => (
          <ObjectiveSessionLine
            key={sessionRowKey(session)}
            session={session}
            missionId={missionId}
            localExecutionTargetId={localExecutionTargetId}
            onAbsent={onAbsent}
          />
        ))}
      </div>
    </>
  );
}
