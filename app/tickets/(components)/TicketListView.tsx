import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';

type Ticket = {
  id: string;
  ticket_number: string | null;
  title: string;
  status: string;
  priority: string;
  assigned_agent: string | null;
  updated_at: string;
};

export default function TicketListView({ tickets }: { tickets: Ticket[] }) {
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
            <h3 className="font-medium">
              <Link href={`/tickets/${ticket.id}`} className="hover:underline">
                {ticket.ticket_number ?? 'TICKET-????'} - {ticket.title}
              </Link>
            </h3>
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
