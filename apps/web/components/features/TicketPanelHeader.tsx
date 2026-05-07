import { ArrowRightToLine, EllipsisVertical } from 'lucide-react';
import Link from 'next/link';

import { CopyTicketIdentifierButton } from '@/components/features/CopyTicketIdentifierButton';
import { DeleteTicketButton } from '@/components/features/DeleteTicketButton';
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
        <Button asChild size="icon" variant="ghost" className="ml-2 h-8 w-10">
          <Link href={closePath} aria-label="Close panel">
            <ArrowRightToLine className="h-4 w-4" />
          </Link>
        </Button>
      </div>
    </div>
  );
}
