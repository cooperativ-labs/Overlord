'use client';

import { RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { type ButtonLoadingState, LoadingButton } from '@/components/ui/loading-button';
import { requestTicketObjectiveExecutionAction } from '@/lib/actions/tickets/ticket-update';

/**
 * Retry action surfaced on a "stalled launch" alert in the activity feed. A
 * stalled launch was cleared from the runner queue (the runner no longer
 * auto-relaunches it), so relaunching is an explicit, user-driven action: this
 * queues a fresh execution request for the same objective.
 */
export function RetryExecutionButton({
  ticketId,
  objectiveId
}: {
  ticketId: string;
  objectiveId: string | null;
}) {
  const [buttonState, setButtonState] = useState<ButtonLoadingState>('default');

  async function handleRetry() {
    setButtonState('loading');
    const result = await requestTicketObjectiveExecutionAction({
      ticketId,
      objectiveId: objectiveId ?? undefined
    });
    if ('error' in result) {
      setButtonState('error');
      toast.error('Failed to relaunch', { description: result.error });
      setTimeout(() => setButtonState('default'), 2000);
      return;
    }
    setButtonState('success');
    toast.success('Relaunch queued', {
      description: 'The objective was re-queued for a runner.'
    });
    setTimeout(() => setButtonState('default'), 2000);
  }

  return (
    <LoadingButton
      buttonState={buttonState}
      className="h-7 w-fit gap-1.5 px-2 text-xs"
      onClick={handleRetry}
      size="sm"
      successText="Re-queued"
      text={
        <>
          <RotateCcw className="size-3.5" />
          Retry
        </>
      }
      variant="outline"
    />
  );
}
