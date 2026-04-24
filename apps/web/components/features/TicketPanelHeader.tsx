import { ArrowRightToLine, EllipsisVertical } from 'lucide-react';
import Link from 'next/link';

import { CopyTicketIdentifierButton } from '@/components/features/CopyTicketIdentifierButton';
import { DeleteTicketButton } from '@/components/features/DeleteTicketButton';
import { TicketHeaderAction } from '@/components/features/TicketHeaderAction';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import type { LaunchAgentTypeValue } from '@/lib/helpers/agent-types';
import type { TicketAssignedAgent } from '@/lib/helpers/ticket-assigned-agent';

type TicketPanelHeaderProps = {
  ticketId: string;
  ticketIdentifier: string;
  projectId: string | null;
  agentFlags: Partial<Record<LaunchAgentTypeValue, string[]>>;
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
  closePath: string;
  isAgentRunning?: boolean;
};

export function TicketPanelHeader({
  ticketId,
  ticketIdentifier,
  projectId,
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
  hasProjectWorkingDirectory,
  closePath,
  isAgentRunning = false
}: TicketPanelHeaderProps) {
  return (
    <div className="relative flex items-center justify-between gap-2 overflow-hidden border-b px-4 py-3">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button aria-label="Ticket actions" className="h-8 w-8" size="icon" variant="ghost">
            <EllipsisVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <div className="flex items-center justify-between gap-2 px-2 py-1.5 text-sm">
            <span>Copy ticket ID</span>
            <CopyTicketIdentifierButton
              value={ticketId}
              ariaLabel="Copy full ticket identifier"
              className="inline-flex h-6 w-6 items-center justify-center rounded-sm hover:bg-accent"
            />
          </div>
          <div className="flex items-center justify-between gap-2 px-2 py-1.5 text-sm">
            <span>Delete ticket</span>
            <DeleteTicketButton
              ticketId={ticketId}
              ticketLabel={ticketIdentifier}
              className="inline-flex h-7 w-7 items-center justify-center"
            />
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
      <div className="flex items-center justify-end gap-2">
        <TicketHeaderAction
          ticketId={ticketId}
          projectId={projectId}
          agentFlags={agentFlags}
          agentIdentifier={agentIdentifier}
          assignedAgent={assignedAgent}
          claudeCommand={claudeCommand}
          codexCommand={codexCommand}
          cursorCommand={cursorCommand}
          geminiCommand={geminiCommand}
          opencodeCommand={opencodeCommand}
          workingDirectory={workingDirectory}
          sshCommand={sshCommand}
          remoteWorkingDirectory={remoteWorkingDirectory}
          hasProjectWorkingDirectory={hasProjectWorkingDirectory}
        />

        <Button asChild size="icon" variant="ghost" className="ml-2 h-8 w-10">
          <Link href={closePath} aria-label="Close panel">
            <ArrowRightToLine className="h-4 w-4" />
          </Link>
        </Button>
      </div>
    </div>
  );
}
