'use client';

import { useState } from 'react';

import type { ButtonLoadingState } from '@/components/ui/loading-button';
import { LoadingButton } from '@/components/ui/loading-button';
import { getTicketDiscussionPromptForCopy } from '@/lib/actions/tickets';
import { getLaunchAgentTypeByIdentifier } from '@/lib/helpers/agent-types';
import { readLocalAgentFlagsFromStorage } from '@/lib/helpers/local-agent-config';

import { useTerminal } from './terminal/TerminalProvider';

type AskTicketButtonProps = {
  ticketId: string;
  agentIdentifier?: string | null;
  agentToken?: string | null;
  workingDirectory?: string | null;
  hasProjectWorkingDirectory?: boolean;
};

export function AskTicketButton({
  ticketId,
  agentIdentifier,
  agentToken,
  workingDirectory,
  hasProjectWorkingDirectory
}: AskTicketButtonProps) {
  const { isElectron, launchAgent } = useTerminal();
  const [askButtonState, setAskButtonState] = useState<ButtonLoadingState>('default');
  const canRunAgent = hasProjectWorkingDirectory ?? true;

  async function handleAsk() {
    if (isElectron && !canRunAgent) {
      return;
    }

    setAskButtonState('loading');

    try {
      const preferredAgent = getLaunchAgentTypeByIdentifier(agentIdentifier);

      if (isElectron) {
        const allFlags = readLocalAgentFlagsFromStorage();
        const agentFlags = allFlags[preferredAgent] ?? [];
        await launchAgent(
          ticketId,
          preferredAgent,
          workingDirectory ?? undefined,
          agentToken ?? undefined,
          'ask',
          agentFlags.length > 0 ? agentFlags : undefined
        );
      } else {
        const { error, prompt } = await getTicketDiscussionPromptForCopy(ticketId);
        if (error || !prompt) {
          throw new Error(error ?? 'Unable to build ask prompt.');
        }
        await navigator.clipboard.writeText(prompt);
      }

      setAskButtonState('success');
    } catch (error) {
      setAskButtonState('error');
      console.error('Failed to run Ask flow:', error);
    }
  }

  return (
    <LoadingButton
      buttonState={askButtonState}
      className="h-8 px-3 text-xs"
      disabled={isElectron && !canRunAgent}
      errorText="Ask failed"
      loadingText="Asking..."
      reset
      setButtonState={setAskButtonState}
      size="sm"
      successText="Ask ready"
      text="Ask"
      variant="outline"
      onClick={handleAsk}
    />
  );
}
