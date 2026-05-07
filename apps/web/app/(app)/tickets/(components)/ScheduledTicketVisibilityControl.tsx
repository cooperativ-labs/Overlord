'use client';

import { useQueryClient } from '@tanstack/react-query';
import { Clock3 } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { saveScheduledTicketVisibilityDaysAction } from '@/lib/actions/scheduled-ticket-visibility-preference';
import { ticketQueryKeys } from '@/lib/client-data/tickets/query-keys';
import { withElectronActionRetry } from '@/lib/electron-auth/action-retry';
import {
  normalizeScheduledTicketVisibilityDays,
  SCHEDULED_TICKET_VISIBILITY_DAY_OPTIONS
} from '@/lib/helpers/scheduled-ticket-visibility';

const saveScheduledTicketVisibilityDaysActionWithRetry = withElectronActionRetry(
  saveScheduledTicketVisibilityDaysAction
);

function formatDaysLabel(days: number): string {
  if (days <= 0) {
    return 'Only when due';
  }

  if (days === 1) {
    return '1 day ahead';
  }

  return `${days} days ahead`;
}

function formatTriggerLabel(days: number): string {
  return days <= 0 ? 'Upcoming: due now' : `Upcoming: ${days}d`;
}

export default function ScheduledTicketVisibilityControl({
  scheduledVisibilityDays
}: {
  scheduledVisibilityDays: number;
}) {
  const queryClient = useQueryClient();
  const [selectedDays, setSelectedDays] = useState(
    normalizeScheduledTicketVisibilityDays(scheduledVisibilityDays)
  );

  async function onValueChange(nextValue: string) {
    const nextDays = normalizeScheduledTicketVisibilityDays(nextValue);
    setSelectedDays(nextDays);
    await saveScheduledTicketVisibilityDaysActionWithRetry(nextDays);
    await queryClient.invalidateQueries({ queryKey: ticketQueryKeys.all });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Clock3 className="h-4 w-4" />
          {formatTriggerLabel(selectedDays)}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44">
        <DropdownMenuLabel>Show scheduled tickets</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={String(selectedDays)} onValueChange={onValueChange}>
          {SCHEDULED_TICKET_VISIBILITY_DAY_OPTIONS.map(days => (
            <DropdownMenuRadioItem key={days} value={String(days)}>
              {formatDaysLabel(days)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
