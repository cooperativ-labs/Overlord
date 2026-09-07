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

import type { TerminalSessionDto } from '../../shared/contract.ts';
import { useCopyToClipboard } from '../lib/hooks/use-copy-to-clipboard.ts';
import {
  forgetAbsentLatchSession,
  isLatchSessionAbsentError,
  useLatchSessionInspection,
  useOpenLatchSession,
  useStopLatchSession
} from '../lib/latch-session-client.ts';
import { useLaunchSettings } from '../lib/queries.ts';
import { cn } from '../lib/utils.ts';

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

/**
 * Live view of one Latch session through its terminal reachability probe.
 *
 * Tracking is deliberately separate from rendering. The panel only ever draws
 * one full card, but a session that is still running has to keep reporting even
 * while it sits collapsed inside the accordion — otherwise streamlining the
 * display would silently stop detecting a session Latch has reclaimed. Queries
 * are keyed by provider session id, so a tracked session that also gets rendered
 * shares one poll rather than doubling it.
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

/** Destructive stop, with its confirmation, shared by the card and the compact rows. */
function EndSessionButton({
  session,
  name,
  disabled,
  compact
}: {
  session: TerminalSessionDto;
  name: string;
  disabled: boolean;
  compact?: boolean;
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
        {compact ? null : 'End session'}
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

/** The full card for a session that is still live. */
function TerminalSessionCard({
  missionId,
  session,
  localExecutionTargetId,
  onAbsent
}: {
  missionId: string;
  session: TerminalSessionDto;
  localExecutionTargetId: string | null;
  onAbsent?: (providerSessionId: string) => void;
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
            <p className="truncate text-sm font-medium">{name}</p>
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            Latch · {session.deviceLabel ?? 'Unknown device'}
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
    </div>
  );
}

/** One line per exited or earlier session: enough to identify it and act on it, nothing more. */
function CompactSessionRow({
  missionId,
  session,
  localExecutionTargetId,
  onAbsent
}: {
  missionId: string;
  session: TerminalSessionDto;
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
        <p className="truncate text-xs font-medium">{name}</p>
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
 * Mission-wide Latch bookkeeping for the objective-centric panel (coo:879).
 *
 * Sessions now render inside the objective that launched them, and a
 * collapsed objective draws nothing — but a running session must stay under
 * observation whether or not its row is open, otherwise collapsing a row would
 * silently stop detecting a session Latch has reclaimed. The provider mounts a
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
 * The Latch sessions one objective launched, rendered inside that objective's
 * accordion (coo:879 §4.2 item 3). `sessions` must be newest first.
 *
 * The newest session gets the full card while it is running; once it has
 * exited it renders as the compact row instead, and earlier sessions
 * (re-launches) are always compact rows. The objective chip the mission-level
 * card used to print is redundant here — the row is the objective — so the
 * card leads with the session name.
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

  const [newest, ...older] = visible;
  const newestIsLive =
    newest!.lastObservedState === 'running' || newest!.lastObservedState === 'stopping';

  return (
    <div className="space-y-1.5">
      {newestIsLive ? (
        <TerminalSessionCard
          missionId={missionId}
          session={newest!}
          localExecutionTargetId={localExecutionTargetId}
          onAbsent={onAbsent}
        />
      ) : (
        <CompactSessionRow
          missionId={missionId}
          session={newest!}
          localExecutionTargetId={localExecutionTargetId}
          onAbsent={onAbsent}
        />
      )}
      {older.map(session => (
        <CompactSessionRow
          key={sessionRowKey(session)}
          missionId={missionId}
          session={session}
          localExecutionTargetId={localExecutionTargetId}
          onAbsent={onAbsent}
        />
      ))}
    </div>
  );
}
