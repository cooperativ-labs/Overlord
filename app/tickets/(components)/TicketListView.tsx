import Link from 'next/link';

import { CopyTicketPromptButton } from '@/components/features/CopyTicketPromptButton';
import { DeleteTicketButton } from '@/components/features/DeleteTicketButton';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { getDisplayTitle, getTicketIdentifier } from '@/lib/helpers/tickets';

type Ticket = {
  id: string;
  title: string | null;
  objective: string | null;
  organization_id: number;
  status: string;
  priority: string;
  assigned_agent: string | null;
  updated_at: string;
  organization_name?: string | null;
};

export default function TicketListView({
  tickets,
  showOrganizationName = false
}: {
  tickets: Ticket[];
  showOrganizationName?: boolean;
}) {
  if (!tickets.length) {
    return (
      <Card>
        <CardContent className="pt-6">No tickets yet. Create the first one.</CardContent>
      </Card>
    );
  }

  return (
    <section className="grid gap-3">
      {tickets.map(ticket => (
        <Card key={ticket.id}>
          <CardContent className="space-y-2 pt-6">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 space-y-1">
                <h3 className="font-medium">
                  <Link
                    href={`/${ticket.organization_id}/${ticket.id}`}
                    className="hover:underline"
                  >
                    {getTicketIdentifier(ticket.id)} — {getDisplayTitle(ticket)}
                  </Link>
                </h3>
                {showOrganizationName && ticket.organization_name ? (
                  <p className="text-muted-foreground text-xs">{ticket.organization_name}</p>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <DeleteTicketButton
                  ticketId={ticket.id}
                  className="h-8 w-8 text-red-600 border-red-600/30 hover:text-white hover:bg-red-600"
                />
                <CopyTicketPromptButton ticketId={ticket.id} variant="icon" className="h-8 w-8" />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{ticket.status}</Badge>
              <Badge>priority {ticket.priority}</Badge>
              {ticket.assigned_agent ? (
                <Badge variant="secondary">{ticket.assigned_agent}</Badge>
              ) : null}
              <span className="text-muted-foreground text-xs">
                updated {new Date(ticket.updated_at).toLocaleString()}
              </span>
            </div>
          </CardContent>
        </Card>
      ))}
    </section>
  );
}
