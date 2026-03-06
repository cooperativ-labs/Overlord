'use client';

import { getLaunchAgentTypeByIdentifier } from '@/lib/helpers/agent-types';

import { useTerminal } from './terminal/TerminalProvider';
import { AskTicketButton } from './AskTicketButton';
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
    return (
      <div className="flex items-center gap-2">
        <AskTicketButton
          ticketId={ticketId}
          agentIdentifier={agentIdentifier}
          agentToken={agentToken}
          workingDirectory={workingDirectory}
          hasProjectWorkingDirectory={hasProjectWorkingDirectory}
        />
        <CopyTicketPromptButton ticketId={ticketId} variant="default" />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <AskTicketButton
        ticketId={ticketId}
        agentIdentifier={agentIdentifier}
        agentToken={agentToken}
        workingDirectory={workingDirectory}
        hasProjectWorkingDirectory={hasProjectWorkingDirectory}
      />
      <AgentSplitButtonLive
        defaultAgent={agentIdentifier ? getLaunchAgentTypeByIdentifier(agentIdentifier) : undefined}
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
    </div>
  );
}
