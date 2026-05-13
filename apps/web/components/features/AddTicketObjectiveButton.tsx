'use client';

import { Loader2, PlusIcon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { type ButtonLoadingState, LoadingButton } from '@/components/ui/loading-button';
import { createEmptyDraftObjectiveAction } from '@/lib/actions/tickets';
import { withElectronActionRetry } from '@/lib/electron-auth/action-retry';

const createEmptyDraftObjectiveActionWithRetry = withElectronActionRetry(
  createEmptyDraftObjectiveAction
);

const addObjectiveButtonClassName =
  'w-full text-[10.5px] uppercase tracking-wider rounded-[0.250rem] shadow-none bg-muted/40 text-muted-foreground border-border/30 hover:bg-muted';

type AddTicketObjectiveButtonProps = {
  ticketId: string;
  disabled?: boolean;
  futureObjectivesEnabled?: boolean;
};

export function AddTicketObjectiveButton({
  ticketId,
  disabled = false,
  futureObjectivesEnabled = false
}: AddTicketObjectiveButtonProps) {
  const [buttonState, setButtonState] = useState<ButtonLoadingState>('default');
  if (!futureObjectivesEnabled) {
    return null;
  }

  async function handleAddObjective() {
    setButtonState('loading');
    try {
      await createEmptyDraftObjectiveActionWithRetry({ ticketId });
      setButtonState('success');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add objective.');
      setButtonState('error');
    }
  }

  const label = (
    <>
      <PlusIcon className="h-4 w-4" />
      Add objective
    </>
  );

  return (
    <LoadingButton
      type="button"
      variant="outline"
      size="sm"
      className={addObjectiveButtonClassName}
      buttonState={buttonState}
      disabled={disabled}
      errorText={label}
      loadingText={
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          Add objective
        </>
      }
      reset
      setButtonState={setButtonState}
      successText={label}
      text={label}
      onClick={handleAddObjective}
    />
  );
}
