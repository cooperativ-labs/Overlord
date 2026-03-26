'use client';

import {
  getLaunchAgentTypeByIdentifier,
  type LaunchAgentTypeValue
} from '@/lib/helpers/agent-types';
import type { TicketAssignedAgent } from '@/lib/helpers/ticket-assigned-agent';

import { useTerminal } from './terminal/TerminalProvider';
import { AgentModelChooserButton } from './AgentModelChooserButton';
import { CopyTicketPromptButton } from './CopyTicketPromptButton';
import { DiscussTicketButton } from './DiscussTicketButton';
import { AgentSplitButtonLive } from './TicketLiveProvider';

type TicketHeaderActionProps = {
  ticketId: string;
  organizationId: number;
  agentToken: string | null;
  agentFlags?: Partial<Record<LaunchAgentTypeValue, string[]>>;
  agentIdentifier: string | null;
  assignedAgent: TicketAssignedAgent | null;
  claudeCommand: string;
  codexCommand: string;
  cursorCommand: string;
  geminiCommand: string;
  opencodeCommand: string;
  workingDirectory: string | null;
  hasProjectWorkingDirectory: boolean;
};

export function TicketHeaderAction({
  ticketId,
  organizationId,
  agentToken,
  agentFlags,
  agentIdentifier,
  assignedAgent,
  claudeCommand,
  codexCommand,
  cursorCommand,
  geminiCommand,
  opencodeCommand,
  workingDirectory,
  hasProjectWorkingDirectory
}: TicketHeaderActionProps) {
  const { isElectron } = useTerminal();

  if (!isElectron) {
    return (
      <div className="flex items-center gap-2">
        <DiscussTicketButton
          ticketId={ticketId}
          organizationId={organizationId}
          agentIdentifier={agentIdentifier}
          agentToken={agentToken}
          agentFlags={agentFlags}
          workingDirectory={workingDirectory}
        />
        <CopyTicketPromptButton ticketId={ticketId} variant="default" />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <AgentModelChooserButton ticketId={ticketId} initialSelection={assignedAgent} />
      <DiscussTicketButton
        ticketId={ticketId}
        organizationId={organizationId}
        agentIdentifier={agentIdentifier}
        agentToken={agentToken}
        agentFlags={agentFlags}
        workingDirectory={workingDirectory}
      />
      <AgentSplitButtonLive
        defaultAgent={
          agentIdentifier || assignedAgent
            ? getLaunchAgentTypeByIdentifier(agentIdentifier ?? assignedAgent?.agent)
            : undefined
        }
        assignedSelection={assignedAgent}
        ticketId={ticketId}
        organizationId={organizationId}
        agentToken={agentToken}
        agentFlags={agentFlags}
        commands={{
          claude: claudeCommand,
          codex: codexCommand,
          cursor: cursorCommand,
          gemini: geminiCommand,
          opencode: opencodeCommand
        }}
        workingDirectory={workingDirectory}
        hasProjectWorkingDirectory={hasProjectWorkingDirectory}
        size="sm"
      />
    </div>
  );
}
