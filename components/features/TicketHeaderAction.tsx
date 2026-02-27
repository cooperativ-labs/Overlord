'use client';

import { getAgentTypeByIdentifier, type LaunchAgentTypeValue } from '@/lib/helpers/agent-types';

import { useTerminal } from './terminal/TerminalProvider';
import { CopyTicketPromptButton } from './CopyTicketPromptButton';
import { AgentSplitButtonLive } from './TicketLiveProvider';

type TicketHeaderActionProps = {
  ticketId: string;
  agentToken: string | null;
  agentIdentifier: string | null;
  claudeCommand: string;
  codexCommand: string;
  cursorCommand: string;
  geminiCommand: string;
  workingDirectory: string | null;
  hasProjectWorkingDirectory: boolean;
};

export function TicketHeaderAction({
  ticketId,
  agentToken,
  agentIdentifier,
  claudeCommand,
  codexCommand,
  cursorCommand,
  geminiCommand,
  workingDirectory,
  hasProjectWorkingDirectory
}: TicketHeaderActionProps) {
  const { isElectron } = useTerminal();

  if (!isElectron) {
    return <CopyTicketPromptButton ticketId={ticketId} runInTerminal={false} variant="default" />;
  }

  return (
    <AgentSplitButtonLive
      defaultAgent={
        (getAgentTypeByIdentifier(agentIdentifier)?.value ?? 'claude') as LaunchAgentTypeValue
      }
      ticketId={ticketId}
      agentToken={agentToken}
      commands={{
        claude: claudeCommand,
        codex: codexCommand,
        cursor: cursorCommand,
        gemini: geminiCommand
      }}
      workingDirectory={workingDirectory}
      hasProjectWorkingDirectory={hasProjectWorkingDirectory}
      size="sm"
    />
  );
}
