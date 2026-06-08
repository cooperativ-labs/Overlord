'use client';

import { ArrowRightToLine, EllipsisVertical } from 'lucide-react';

import { Button } from '@/components/ui/button';

import { DEMO_TICKET_DETAILS } from './mock-ticket-details';

export function DemoPanelHeader() {
  return (
    <div className="relative flex items-center justify-between gap-2 border-b px-4 py-2.5">
      <div className="flex items-center gap-2">
        <Button
          aria-label="Ticket actions"
          className="h-7 w-7"
          size="icon"
          variant="ghost"
          type="button"
        >
          <EllipsisVertical className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="flex items-center justify-end gap-3">
        <div className="flex items-center gap-1.5">
          <span className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs">
            <span
              className="h-2.5 w-2.5 rounded-[3px]"
              style={{ backgroundColor: DEMO_TICKET_DETAILS.project_color }}
            />
            <span className="font-medium">{DEMO_TICKET_DETAILS.project_name}</span>
            <span className="font-mono text-muted-foreground">
              {DEMO_TICKET_DETAILS.ticket_identifier}
            </span>
          </span>
          <div className="h-3.5 w-px bg-border" />
        </div>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          type="button"
          aria-label="Close panel"
        >
          <ArrowRightToLine className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
