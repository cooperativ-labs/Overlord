'use client';

import {
  getLaunchAgentTypeByIdentifier,
  type LaunchAgentTypeValue
} from '@/lib/helpers/agent-types';
import type { SshServerProfileSummary } from '@/lib/actions/ssh-servers';

import { useTerminal } from './terminal/TerminalProvider';
import { AskTicketButton } from './AskTicketButton';
import { AgentSplitButtonLive } from './TicketLiveProvider';
import { WebLaunchSplitButton } from './WebLaunchSplitButton';

type TicketHeaderActionProps = {
  ticketId: string;
  agentToken: string | null;
  agentFlags?: Partial<Record<LaunchAgentTypeValue, string[]>>;
  agentIdentifier: string | null;
  claudeCommand: string;
  codexCommand: string;
  cursorCommand: string;
  geminiCommand: string;
  workingDirectory: string | null;
  hasProjectWorkingDirectory: boolean;
  sshProfiles: SshServerProfileSummary[];
};

export function TicketHeaderAction({
  ticketId,
  agentToken,
  agentFlags,
  agentIdentifier,
  claudeCommand,
  codexCommand,
  cursorCommand,
  geminiCommand,
  workingDirectory,
  hasProjectWorkingDirectory,
  sshProfiles
}: TicketHeaderActionProps) {
  const { isElectron } = useTerminal();

  if (!isElectron) {
    return (
      <div className="flex items-center gap-2">
        <AskTicketButton
          ticketId={ticketId}
          agentIdentifier={agentIdentifier}
          agentToken={agentToken}
          agentFlags={agentFlags}
          workingDirectory={workingDirectory}
          hasProjectWorkingDirectory={hasProjectWorkingDirectory}
        />
        <WebLaunchSplitButton
          ticketId={ticketId}
          agentToken={agentToken}
          sshProfiles={sshProfiles}
        />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <AskTicketButton
        ticketId={ticketId}
        agentIdentifier={agentIdentifier}
        agentToken={agentToken}
        agentFlags={agentFlags}
        workingDirectory={workingDirectory}
        hasProjectWorkingDirectory={hasProjectWorkingDirectory}
      />
      <AgentSplitButtonLive
        defaultAgent={agentIdentifier ? getLaunchAgentTypeByIdentifier(agentIdentifier) : undefined}
        ticketId={ticketId}
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
