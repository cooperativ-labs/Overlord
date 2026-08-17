import { AlertTriangle, Check, Copy, ExternalLink, Loader2, Monitor, Octagon } from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';

import type { TerminalSessionDto } from '../../shared/contract.ts';
import { useCopyToClipboard } from '../lib/hooks/use-copy-to-clipboard.ts';
import {
  useLatchHarnessEventIngest,
  useLatchSessionInspection,
  useOpenLatchSession,
  useResolveLatchObservation,
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

/**
 * Live view of one Latch session: the reachability probe plus the harness-event
 * ingest that feeds mission activity.
 *
 * Tracking is deliberately separate from rendering. The panel only ever draws
 * one full card, but a session that is still running has to keep reporting even
 * while it sits collapsed inside the accordion — otherwise streamlining the
 * display would silently stop watching real work. Both queries are keyed by
 * provider session id, so a tracked session that also gets rendered shares one
 * poll rather than doubling it.
 */
function useLatchSessionTracking({
  session,
  missionId,
  localExecutionTargetId
}: {
  session: TerminalSessionDto;
  missionId: string;
  localExecutionTargetId: string | null;
}) {
  const onThisDevice =
    Boolean(localExecutionTargetId) && session.executionTargetId === localExecutionTargetId;
  const inspection = useLatchSessionInspection({ session, enabled: onThisDevice });
  const events = useLatchHarnessEventIngest({ session, missionId, enabled: onThisDevice });
  return {
    onThisDevice,
    inspection,
    events,
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
  localExecutionTargetId
}: {
  session: TerminalSessionDto;
  missionId: string;
  localExecutionTargetId: string | null;
}) {
  useLatchSessionTracking({ session, missionId, localExecutionTargetId });
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

/** The full card for the session the current objective is running in. */
function TerminalSessionCard({
  missionId,
  session,
  localExecutionTargetId,
  footer
}: {
  missionId: string;
  session: TerminalSessionDto;
  localExecutionTargetId: string | null;
  /** Rendered inside the card, below its own controls (the other-sessions accordion). */
  footer?: ReactNode;
}) {
  const { copied, copy } = useCopyToClipboard();
  const { inspection, events, state, name, reachable, checking } = useLatchSessionTracking({
    session,
    missionId,
    localExecutionTargetId
  });
  const openSession = useOpenLatchSession(session);
  const resolveObservation = useResolveLatchObservation(session, missionId);
  const attachCommand = `${session.executable} attach ${session.providerSessionId}`;
  const viewer = viewerLabel(session.viewerKind);
  const canStop = reachable && state === 'running';
  const pending = session.observation?.pendingInput ?? null;
  const unattached = session.observation?.unattached === true;

  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Monitor className="h-4 w-4 shrink-0 text-muted-foreground" />
            <p className="truncate text-sm font-medium">{name}</p>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
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

      {unattached ? (
        <div className="mt-3 flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-800 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <p>
            This Latch session has produced turns, but the agent has not attached to the mission.
            Protocol attach is the binding record; Latch observation is presentation only.
          </p>
        </div>
      ) : null}

      {pending ? (
        <div className="mt-3 space-y-2 rounded-md border border-border bg-muted/40 p-2">
          <p className="text-xs font-medium capitalize">{pending.kind}</p>
          <p className="text-xs text-muted-foreground">{pending.prompt}</p>
          <div className="flex flex-wrap gap-2">
            {(pending.choices.length > 0 ? pending.choices : ['Allow', 'Deny']).map(choice => (
              <Button
                key={choice}
                type="button"
                size="sm"
                variant="outline"
                disabled={!reachable || resolveObservation.isPending}
                onClick={() => resolveObservation.mutate({ requestId: pending.requestId, choice })}
              >
                {resolveObservation.isPending ? <Loader2 className="animate-spin" /> : null}
                {choice}
              </Button>
            ))}
          </div>
          {resolveObservation.isError ? (
            <p className="text-xs text-destructive">
              {resolveObservation.error instanceof Error
                ? resolveObservation.error.message
                : 'Could not resolve the Latch prompt.'}
            </p>
          ) : null}
        </div>
      ) : null}

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
      {inspection.isError || openSession.isError || events.isError ? (
        <p className="mt-2 text-xs text-destructive">
          {(inspection.error ?? openSession.error ?? events.error)?.message ??
            'Latch session action failed.'}
        </p>
      ) : null}

      {footer}
    </div>
  );
}

/** One line per other session: enough to identify it and act on it, nothing more. */
function OtherSessionRow({
  missionId,
  session,
  localExecutionTargetId
}: {
  missionId: string;
  session: TerminalSessionDto;
  localExecutionTargetId: string | null;
}) {
  const { state, name, reachable } = useLatchSessionTracking({
    session,
    missionId,
    localExecutionTargetId
  });
  const openSession = useOpenLatchSession(session);
  const viewer = viewerLabel(session.viewerKind);

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

/**
 * Latch sessions for the mission, shown as **one** card.
 *
 * A long-running mission accumulates a session per objective, and rendering
 * every one of them turned the panel into a wall of near-identical widgets. The
 * current objective's session gets the full card; everything else collapses into
 * an accordion at the bottom of it whose trigger counts the other connections
 * that are still running. Collapsed sessions are still polled and still ingest
 * harness events (see {@link LatchSessionTracker}) — this changes what the panel
 * draws, not what Overlord watches.
 */
export function TerminalSessionsSection({
  missionId,
  workspaceId,
  sessions,
  currentObjectiveId
}: {
  missionId: string;
  workspaceId: string;
  sessions: TerminalSessionDto[];
  /** The objective whose Latch session is the one worth showing in full. */
  currentObjectiveId: string | null;
}) {
  const launchSettings = useLaunchSettings(workspaceId);
  const localExecutionTargetId = launchSettings.data?.executionTargetId ?? null;

  const { current, others, runningOtherCount } = useMemo(
    () => selectLatchSessionDisplay(sessions, currentObjectiveId),
    [sessions, currentObjectiveId]
  );

  if (!current) return null;

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wide text-(--color-ink-dim)">
          Terminal session
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Terminal state is independent from mission and agent-session status.
        </p>
      </div>

      <TerminalSessionCard
        missionId={missionId}
        session={current}
        localExecutionTargetId={localExecutionTargetId}
        footer={
          others.length > 0 ? (
            <Accordion className="mt-3 border-t border-border pt-1">
              <AccordionItem value="other-latch-sessions" className="border-b-0">
                <AccordionTrigger className="py-2 text-xs font-medium text-muted-foreground hover:no-underline">
                  <span className="flex items-center gap-2">
                    <span
                      className={cn(
                        'inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold',
                        runningOtherCount > 0
                          ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                          : 'bg-muted text-muted-foreground'
                      )}
                    >
                      {runningOtherCount}
                    </span>
                    {runningOtherCount === 1
                      ? 'other Latch connection running'
                      : 'other Latch connections running'}
                  </span>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-1.5">
                    {others.map(session => (
                      <OtherSessionRow
                        key={sessionRowKey(session)}
                        missionId={missionId}
                        session={session}
                        localExecutionTargetId={localExecutionTargetId}
                      />
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          ) : null
        }
      />

      {/*
        Running sessions that are not drawn are still watched. Rendered rows use
        the same query keys, so an expanded accordion does not double the polling.
      */}
      {others
        .filter(session => session.lastObservedState === 'running')
        .map(session => (
          <LatchSessionTracker
            key={`tracker:${sessionRowKey(session)}`}
            missionId={missionId}
            session={session}
            localExecutionTargetId={localExecutionTargetId}
          />
        ))}
    </section>
  );
}
