import { ArrowRightToLine, EllipsisVertical } from 'lucide-react';
import Link from 'next/link';

import { CopyTicketIdentifierButton } from '@/components/features/CopyTicketIdentifierButton';
import { DeleteTicketButton } from '@/components/features/DeleteTicketButton';
import { TicketProjectSelect } from '@/components/features/TicketProjectSelect';
import { TicketStatusSelect } from '@/components/features/TicketStatusSelect';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';

type ProjectOption = {
  id: string;
  name: string;
  color: string;
  everhour_project_id: string | null;
};

type TicketPanelHeaderProps = {
  ticketId: string;
  ticketIdentifier: string;
  organizationId: number;
  projectId: string | null;
  projects: ProjectOption[];
  currentStatus: string;
  statusOptions: string[];
  closePath: string;
};

export function TicketPanelHeader({
  ticketId,
  ticketIdentifier,
  organizationId,
  projectId,
  projects,
  currentStatus,
  statusOptions,
  closePath
}: TicketPanelHeaderProps) {
  return (
    <div className="relative flex items-center justify-between gap-2 overflow-hidden border-b px-4 py-2.5">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button aria-label="Ticket actions" className="h-7 w-7" size="icon" variant="ghost">
            <EllipsisVertical className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <div className="flex items-center justify-between gap-2 px-2 py-1.5 text-sm">
            <span>
              Ticket ID: <strong>{ticketIdentifier}</strong>
            </span>
            <CopyTicketIdentifierButton
              value={ticketIdentifier}
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
      <div className="flex items-center justify-end gap-3">
        <div className="flex items-center gap-1.5">
          <TicketProjectSelect
            ticketId={ticketId}
            organizationId={organizationId}
            currentProjectId={projectId}
            projects={projects}
          />
          <div className="h-3.5 w-px bg-border" />
          <TicketStatusSelect
            ticketId={ticketId}
            currentStatus={currentStatus}
            statusOptions={statusOptions}
          />
        </div>

        <Button asChild size="icon" variant="ghost" className="h-7 w-7">
          <Link href={closePath} aria-label="Close panel">
            <ArrowRightToLine className="h-3.5 w-3.5" />
          </Link>
        </Button>
      </div>
    </div>
  );
}
