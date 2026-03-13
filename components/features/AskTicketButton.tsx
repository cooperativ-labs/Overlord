'use client';

import { useState } from 'react';

import type { ButtonLoadingState } from '@/components/ui/loading-button';
import { LoadingButton } from '@/components/ui/loading-button';
import { getTicketDiscussionPromptForCopy } from '@/lib/actions/tickets';
import {
  getLaunchAgentTypeByIdentifier,
  type LaunchAgentTypeValue
} from '@/lib/helpers/agent-types';

import { useTerminal } from './terminal/TerminalProvider';
import { useLocalDirectoryAccess } from './terminal/useLocalDirectoryAccess';

type AskTicketButtonProps = {
  ticketId: string;
  agentIdentifier?: string | null;
  agentToken?: string | null;
  agentFlags?: Partial<Record<LaunchAgentTypeValue, string[]>>;
  workingDirectory?: string | null;
  hasProjectWorkingDirectory?: boolean;
};

export function AskTicketButton({
  ticketId,
  agentIdentifier,
  agentToken,
  agentFlags,
  workingDirectory,
  hasProjectWorkingDirectory
}: AskTicketButtonProps) {
  const { isElectron, launchAgent } = useTerminal();
  const [askButtonState, setAskButtonState] = useState<ButtonLoadingState>('default');
  const canRunAgent = useLocalDirectoryAccess({ workingDirectory, hasProjectWorkingDirectory });

  async function handleAsk() {
    if (isElectron && !canRunAgent) {
      return;
    }

    setAskButtonState('loading');

    try {
      const preferredAgent = getLaunchAgentTypeByIdentifier(agentIdentifier);

      if (isElectron) {
        await launchAgent(
          ticketId,
          preferredAgent,
          workingDirectory ?? undefined,
          agentToken ?? undefined,
          'ask',
          agentFlags?.[preferredAgent]
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
