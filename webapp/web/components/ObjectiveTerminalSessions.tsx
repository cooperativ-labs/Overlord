import { useQueryClient } from '@tanstack/react-query';
import { Check, Copy, ExternalLink, Loader2, Monitor, Octagon } from 'lucide-react';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState
} from 'react';

import type { ObjectiveDto, TerminalSessionDto } from '../../shared/contract.ts';
import { useCopyToClipboard } from '../lib/hooks/use-copy-to-clipboard.ts';
import {
  forgetAbsentLatchSession,
  isLatchSessionAbsentError,
  useLatchSessionInspection,
  useOpenLatchSession,
  useStopLatchSession
} from '../lib/latch-session-client.ts';
import { selectLatchSessionDisplay } from '../lib/latch-session-display.ts';
import { useLaunchSettings } from '../lib/queries.ts';
import { cn } from '../lib/utils.ts';

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from './ui/accordion.tsx';
import { Button } from './ui/button.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from './ui/dialog.tsx';

const stateTone: Record<TerminalSessionDto['lastObservedState'], string> = {
  running: 'bg-emerald-500',
  stopping: 'bg-amber-500',
  exited: 'bg-muted-foreground',
  lost: 'bg-destructive'
};

function viewerLabel(kind: string): string {
  return kind === 'iterm' || kind === 'iterm2' ? 'iTerm' : kind;
}

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

/** Destructive stop, with its confirmation, shared by the card, the compact rows, and the objective line. */
function EndSessionButton({
  session,
  name,
  disabled,
  compact,
  label
}: {
  session: TerminalSessionDto;
  name: string;
  disabled: boolean;
  /** Icon-only ghost styling for tight rows. */
  compact?: boolean;
  /** Text next to the icon. Defaults to "End session" on the full card, nothing when compact. */
  label?: string;
}) {
  const [confirmStop, setConfirmStop] = useState(false);
  const stopSession = useStopLatchSession(session);

  async function handleStop() {
    try {
      await stopSession.mutateAsync();
      setConfirmStop(false);
    } catch {
      // The mutation error stays visible and the confirmation stays open.
    }
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant={compact ? 'ghost' : 'destructive'}
        className={cn(compact && 'text-destructive hover:text-destructive')}
        disabled={disabled || stopSession.isPending}
        onClick={() => setConfirmStop(true)}
      >
        <Octagon />
        {label ?? (compact ? null : 'End session')}
      </Button>
      <Dialog open={confirmStop} onOpenChange={setConfirmStop}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>End terminal session?</DialogTitle>
            <DialogDescription>
              This stops the Latch process group for “{name}”. It is destructive and is separate
              from closing a viewer. Delivering or completing the objective does not stop it.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmStop(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={stopSession.isPending}
              onClick={() => void handleStop()}
            >
              {stopSession.isPending ? <Loader2 className="animate-spin" /> : <Octagon />}
              {stopSession.isPending ? 'Ending…' : 'End terminal session'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {stopSession.isError ? (
        <p className="w-full text-xs text-destructive">
          {stopSession.error instanceof Error
            ? stopSession.error.message
            : 'Latch session action failed.'}
        </p>
      ) : null}
    </>
  );
}

/** The full card for the current Latch session. */
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
  const { copied, copy } = useCopyToClipboard();
  const { inspection, absent, state, name, reachable, checking } = useLatchSessionTracking({
    session,
    missionId,
    localExecutionTargetId,
    onAbsent
  });
  const openSession = useOpenLatchSession(session);
  const attachCommand = `${session.executable} attach ${session.providerSessionId}`;
  const viewer = viewerLabel(session.viewerKind);
  const canStop = reachable && state === 'running';

  if (absent) return null;

  return (
    <div className="rounded-lg border border-border bg-background p-3">
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

      <div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {checking ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
        <span>
          {reachable
            ? 'Reachable from this device'
            : checking
              ? 'Checking device reachability…'
              : 'Device is not reachable from this client'}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!reachable || openSession.isPending}
          onClick={() => openSession.mutate()}
        >
          {openSession.isPending ? <Loader2 className="animate-spin" /> : <ExternalLink />}
          Open in {viewer}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => void copy(attachCommand)}>
          {copied ? <Check /> : <Copy />}
          {copied ? 'Copied' : 'Copy attach command'}
        </Button>
        <EndSessionButton session={session} name={name} disabled={!canStop} />
      </div>

      <p className="mt-2 text-[11px] text-muted-foreground">
        The attach command is a developer path. For another device, SSH to{' '}
        {session.deviceLabel ?? 'the host'} using your own SSH access, then run it there.
      </p>
      {inspection.isError || openSession.isError ? (
        <p className="mt-2 text-xs text-destructive">
          {(inspection.error ?? openSession.error)?.message ?? 'Latch session action failed.'}
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
  const openSession = useOpenLatchSession(session);
  const viewer = viewerLabel(session.viewerKind);

  if (absent) return null;

  return (
    <div className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/30 px-2 py-1.5">
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
      <Button
        type="button"
        size="sm"
        variant="ghost"
        aria-label={`Open ${name} in ${viewer}`}
        disabled={!reachable || openSession.isPending}
        onClick={() => openSession.mutate()}
      >
        {openSession.isPending ? <Loader2 className="animate-spin" /> : <ExternalLink />}
      </Button>
      <EndSessionButton
        session={session}
        name={name}
        disabled={!reachable || state !== 'running'}
        compact
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
 * The full controls render once per mission in
 * {@link MissionTerminalSessionsSection}, and each objective row keeps a
 * minimal line — but a running session must stay under observation whether or
 * not either is on screen, otherwise collapsing a row would silently stop
 * detecting a session Latch has reclaimed. The provider mounts a
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

/**
 * The mission-wide Latch controls (coo:990): every session the mission
 * launched, drawn together above the artifacts rather than scattered across the
 * objective rows that produced them. This is where the full controls live —
 * open in a viewer, copy the attach command, end the session — because the
 * reader wants "what terminals does this mission have open" answered in one
 * place.
 *
 * One current session gets the full card; previous sessions collapse into an
 * accordion below its controls, the same pattern the mission-level section used
 * before coo:879. Each one names its objective, since the card no longer sits
 * inside it.
 */
export function MissionTerminalSessionsSection({
  sessions,
  objectives
}: {
  /** Every session on the mission, newest first. */
  sessions: readonly TerminalSessionDto[];
  /** The mission's objectives, used to label each session with what it ran. */
  objectives: readonly ObjectiveDto[];
}) {
  const { missionId, localExecutionTargetId, onAbsent, isAbsent } = useLatchSessionContext();
  const visible = sessions.filter(session => !isAbsent(session.providerSessionId));
  const { current, others, runningOtherCount } = selectLatchSessionDisplay(visible);
  if (!current) return null;

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wide text-(--color-ink-dim)">
          Terminal sessions
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Terminal state is independent from mission and agent-session status.
        </p>
      </div>
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
    </div>
  );
}

/** The minimal one-line control strip for one session inside its objective row. */
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
  const { copied, copy } = useCopyToClipboard();
  const { state, name, reachable, absent } = useLatchSessionTracking({
    session,
    missionId,
    localExecutionTargetId,
    onAbsent
  });
  const attachCommand = `${session.executable} attach ${session.providerSessionId}`;

  if (absent) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className={cn('h-2 w-2 shrink-0 rounded-full', stateTone[state])} aria-hidden="true" />
      <Button type="button" size="sm" variant="ghost" onClick={() => void copy(attachCommand)}>
        {copied ? <Check /> : <Copy />}
        {copied ? 'Copied' : 'Latch attach'}
      </Button>
      <EndSessionButton
        session={session}
        name={name}
        disabled={!reachable || state !== 'running'}
        compact
        label="End session"
      />
    </div>
  );
}

/**
 * The Latch sessions one objective launched, rendered inside that objective's
 * accordion. `sessions` must be newest first.
 *
 * Deliberately minimal (coo:990): the full controls now live in the
 * mission-level {@link MissionTerminalSessionsSection}, so an objective row
 * keeps only what is worth acting on without leaving it — one line per session
 * with a "Latch attach" copy button and an end-session button.
 */
export function ObjectiveTerminalSessions({
  sessions,
  emptyState
}: {
  sessions: readonly TerminalSessionDto[];
  /** Rendered when the objective launched no session (or every session was forgotten). */
  emptyState?: ReactNode;
}) {
  const { missionId, localExecutionTargetId, onAbsent, isAbsent } = useLatchSessionContext();
  const visible = sessions.filter(session => !isAbsent(session.providerSessionId));
  if (visible.length === 0) return <>{emptyState ?? null}</>;

  return (
    <div className="space-y-1">
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
  );
}
