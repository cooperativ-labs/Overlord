'use client';

import { useState } from 'react';

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
import { type WebAgentMode, WebAgentModeButton } from './WebAgentModeButton';

type TicketHeaderActionProps = {
  ticketId: string;
  projectId: string;
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
  sshCommand: string | null;
  remoteWorkingDirectory: string | null;
  hasProjectWorkingDirectory: boolean;
};

export function TicketHeaderAction({
  ticketId,
  projectId,
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
  sshCommand,
  remoteWorkingDirectory,
  hasProjectWorkingDirectory
}: TicketHeaderActionProps) {
  const { isElectron } = useTerminal();
  const [webMode, setWebMode] = useState<WebAgentMode>('local');

  if (!isElectron) {
    return (
      <div className="flex items-center gap-2">
        <WebAgentModeButton mode={webMode} onModeChange={setWebMode} />
        <DiscussTicketButton
          ticketId={ticketId}
          agentToken={agentToken}
          agentFlags={agentFlags}
          webMode={webMode}
        />
        <CopyTicketPromptButton
          ticketId={ticketId}
          context={webMode === 'local' ? 'cli' : 'web'}
          variant="default"
        />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <AgentModelChooserButton ticketId={ticketId} initialSelection={assignedAgent} />
      <DiscussTicketButton
        ticketId={ticketId}
        projectId={projectId}
        organizationId={organizationId}
        agentIdentifier={agentIdentifier}
        assignedAgent={assignedAgent}
        agentToken={agentToken}
        agentFlags={agentFlags}
        workingDirectory={workingDirectory}
        sshCommand={sshCommand}
        remoteWorkingDirectory={remoteWorkingDirectory}
      />
      <AgentSplitButtonLive
        defaultAgent={
          agentIdentifier || assignedAgent
            ? getLaunchAgentTypeByIdentifier(agentIdentifier ?? assignedAgent?.agent)
            : undefined
        }
        assignedSelection={assignedAgent}
        ticketId={ticketId}
        projectId={projectId}
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
        sshCommand={sshCommand}
        remoteWorkingDirectory={remoteWorkingDirectory}
        hasProjectWorkingDirectory={hasProjectWorkingDirectory}
        size="sm"
      />
    </div>
  );
}
