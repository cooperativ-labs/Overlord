import { Check, Copy, ExternalLink, Loader2, Monitor, Octagon } from 'lucide-react';
import { useState } from 'react';

import type { TerminalSessionDto } from '../../shared/contract.ts';
import { useCopyToClipboard } from '../lib/hooks/use-copy-to-clipboard.ts';
import {
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

function TerminalSessionCard({
  session,
  localExecutionTargetId
}: {
  session: TerminalSessionDto;
  localExecutionTargetId: string | null;
}) {
  const [confirmStop, setConfirmStop] = useState(false);
  const { copied, copy } = useCopyToClipboard();
  const onThisDevice =
    Boolean(localExecutionTargetId) && session.executionTargetId === localExecutionTargetId;
  const inspection = useLatchSessionInspection({ session, enabled: onThisDevice });
  const openSession = useOpenLatchSession(session);
  const stopSession = useStopLatchSession(session);
  const state = inspection.data?.state ?? session.lastObservedState;
  const name = inspection.data?.name ?? session.sessionName;
  const reachable = onThisDevice && inspection.isSuccess;
  const checking = onThisDevice && inspection.isPending;
  const attachCommand = `${session.executable} attach ${session.providerSessionId}`;
  const viewer = viewerLabel(session.viewerKind);
  const canStop = reachable && state === 'running';

  async function handleStop() {
    try {
      await stopSession.mutateAsync();
      setConfirmStop(false);
    } catch {
      // The mutation error remains visible in the card and the confirmation stays open.
    }
  }

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
        <Button
          type="button"
          size="sm"
          variant="destructive"
          disabled={!canStop || stopSession.isPending}
          onClick={() => setConfirmStop(true)}
        >
          <Octagon />
          End session
        </Button>
      </div>

      <p className="mt-2 text-[11px] text-muted-foreground">
        The attach command is a developer path. For another device, SSH to{' '}
        {session.deviceLabel ?? 'the host'} using your own SSH access, then run it there.
      </p>
      {inspection.isError || openSession.isError || stopSession.isError ? (
        <p className="mt-2 text-xs text-destructive">
          {(inspection.error ?? openSession.error ?? stopSession.error)?.message ??
            'Latch session action failed.'}
        </p>
      ) : null}

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
    </div>
  );
}

export function TerminalSessionsSection({
  workspaceId,
  sessions
}: {
  workspaceId: string;
  sessions: TerminalSessionDto[];
}) {
  const launchSettings = useLaunchSettings(workspaceId);
  if (sessions.length === 0) return null;

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wide text-(--color-ink-dim)">
          Terminal sessions
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Terminal state is independent from mission and agent-session status.
        </p>
      </div>
      <div className="space-y-2">
        {sessions.map(session => (
          <TerminalSessionCard
            key={`${session.executionRequestId}:${session.providerSessionId}`}
            session={session}
            localExecutionTargetId={launchSettings.data?.executionTargetId ?? null}
          />
        ))}
      </div>
    </section>
  );
}
