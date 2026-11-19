import type { TerminalSessionDto } from '@overlord/contract';
import { Check, Copy, ExternalLink, Loader2, Octagon } from 'lucide-react';
import { useState } from 'react';

import { useCopyToClipboard } from '../lib/hooks/use-copy-to-clipboard.ts';
import { useOpenLatchSession, useStopLatchSession } from '../lib/latch-session-client.ts';
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

export function viewerLabel(kind: string): string {
  return kind === 'iterm' || kind === 'iterm2' ? 'iTerm' : kind;
}

export function latchAttachCommand(session: TerminalSessionDto): string {
  return `${session.executable} attach ${session.providerSessionId}`;
}

/**
 * How much room the controls get.
 *
 * - `card`: the mission Latch popover. A full-width primary Open button, with
 *   Copy command and End session side by side beneath it (coo:1303).
 * - `minimal`: the objective detail. The same arrangement at a lighter weight:
 *   an outline Open button over two quiet text actions (coo:1303).
 * - `inline`: one-line rows (previous sessions). Icon-only, in a single strip.
 */
export type LatchSessionActionsLayout = 'card' | 'minimal' | 'inline';

/**
 * The one set of Latch session controls — open in a viewer, copy the attach
 * command, end the session (with its confirmation) — used everywhere a session
 * offers them, so the three never drift apart between surfaces.
 *
 * Reachability and the observed state come from the caller's session tracking;
 * this component owns only the actions and their errors.
 */
export function LatchSessionActions({
  session,
  name,
  state,
  reachable,
  layout,
  className
}: {
  session: TerminalSessionDto;
  /** The session's display name, used in labels and the end confirmation. */
  name: string;
  state: TerminalSessionDto['lastObservedState'];
  /** True when this client can reach the session's device. */
  reachable: boolean;
  layout: LatchSessionActionsLayout;
  className?: string;
}) {
  const { copied, copy } = useCopyToClipboard();
  const openSession = useOpenLatchSession(session);
  const stopSession = useStopLatchSession(session);
  const [confirmStop, setConfirmStop] = useState(false);

  const attachCommand = latchAttachCommand(session);
  const viewer = viewerLabel(session.viewerKind);
  const canOpen = reachable && !openSession.isPending;
  const canStop = reachable && state === 'running' && !stopSession.isPending;

  const openIcon = openSession.isPending ? <Loader2 className="animate-spin" /> : <ExternalLink />;
  const copyIcon = copied ? <Check /> : <Copy />;
  const openSessionNow = () => openSession.mutate();
  const copyCommand = () => void copy(attachCommand);
  const askToStop = () => setConfirmStop(true);

  async function handleStop() {
    try {
      await stopSession.mutateAsync();
      setConfirmStop(false);
    } catch {
      // The mutation error stays visible and the confirmation stays open.
    }
  }

  const actionError = openSession.error ?? stopSession.error;
  const error = actionError ? (
    <p className="w-full text-xs text-destructive">
      {actionError instanceof Error ? actionError.message : 'Latch session action failed.'}
    </p>
  ) : null;

  const confirmation = (
    <Dialog open={confirmStop} onOpenChange={setConfirmStop}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>End terminal session?</DialogTitle>
          <DialogDescription>
            This stops the Latch process group for “{name}”. It is destructive and is separate from
            closing a viewer. Delivering or completing the objective does not stop it.
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
  );

  if (layout === 'inline') {
    const openLabel = `Open ${name} in ${viewer}`;
    const copyLabel = copied ? 'Copied attach command' : 'Copy Latch attach command';
    return (
      <>
        <div className={cn('flex shrink-0 items-center', className)} data-latch-actions="inline">
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={openLabel}
            title={openLabel}
            disabled={!canOpen}
            onClick={openSessionNow}
          >
            {openIcon}
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={copyLabel}
            title={copyLabel}
            onClick={copyCommand}
          >
            {copyIcon}
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            aria-label="End session"
            title="End session"
            disabled={!canStop}
            onClick={askToStop}
          >
            <Octagon />
          </Button>
        </div>
        {error}
        {confirmation}
      </>
    );
  }

  const minimal = layout === 'minimal';

  // One primary action, with the secondary ones side by side beneath it (coo:1303).
  return (
    <div className={cn('grid', minimal ? 'gap-1' : 'gap-2', className)} data-latch-actions={layout}>
      <Button
        type="button"
        size={minimal ? 'sm' : 'default'}
        variant={minimal ? 'outline' : 'default'}
        className="w-full"
        disabled={!canOpen}
        onClick={openSessionNow}
      >
        {openIcon}
        Open in {viewer}
      </Button>
      <div className={cn('grid grid-cols-2', minimal ? 'gap-1' : 'gap-2')}>
        <Button
          type="button"
          size={minimal ? 'xs' : 'sm'}
          variant={minimal ? 'ghost' : 'outline'}
          className={cn(minimal && 'text-muted-foreground')}
          title={attachCommand}
          onClick={copyCommand}
        >
          {copyIcon}
          {copied ? 'Copied' : 'Copy command'}
        </Button>
        <Button
          type="button"
          size={minimal ? 'xs' : 'sm'}
          variant={minimal ? 'ghost' : 'destructive'}
          className={cn(minimal && 'text-destructive hover:text-destructive')}
          disabled={!canStop}
          onClick={askToStop}
        >
          <Octagon />
          End session
        </Button>
      </div>
      {error}
      {confirmation}
    </div>
  );
}
