'use client';

import {
  getLaunchAgentTypeByIdentifier,
  type LaunchAgentTypeValue
} from '@/lib/helpers/agent-types';

import { useTerminal } from './terminal/TerminalProvider';
import { AskTicketButton } from './AskTicketButton';
import { CopyTicketPromptButton } from './CopyTicketPromptButton';
import { AgentSplitButtonLive } from './TicketLiveProvider';

type TicketHeaderActionProps = {
  ticketId: string;
  organizationId: number;
  agentToken: string | null;
  agentFlags?: Partial<Record<LaunchAgentTypeValue, string[]>>;
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
  organizationId,
  agentToken,
  agentFlags,
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
          organizationId={organizationId}
          agentIdentifier={agentIdentifier}
          agentToken={agentToken}
          agentFlags={agentFlags}
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
        organizationId={organizationId}
        agentIdentifier={agentIdentifier}
        agentToken={agentToken}
        agentFlags={agentFlags}
        workingDirectory={workingDirectory}
        hasProjectWorkingDirectory={hasProjectWorkingDirectory}
      />
      <AgentSplitButtonLive
        defaultAgent={agentIdentifier ? getLaunchAgentTypeByIdentifier(agentIdentifier) : undefined}
        ticketId={ticketId}
        organizationId={organizationId}
        agentToken={agentToken}
        agentFlags={agentFlags}
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
