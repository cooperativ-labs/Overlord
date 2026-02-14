import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent } from '@/components/ui/card';
import { createClient } from '@/supabase/utils/server';

import KanbanBoard from './tickets/(components)/KanbanBoard';
import TicketListView from './tickets/(components)/TicketListView';
import TicketsViewToggle from './tickets/(components)/TicketsViewToggle';

const statusOrder = [
  'draft',
  'review',
  'refine',
  'execute',
  'deliver',
  'complete',
  'blocked',
  'cancelled'
];

function sortByStatus<T extends { status: string }>(items: T[]): T[] {
  const statusWeight = new Map(statusOrder.map((status, index) => [status, index]));
  return [...items].sort((left, right) => {
    const leftWeight = statusWeight.get(left.status) ?? 999;
    const rightWeight = statusWeight.get(right.status) ?? 999;
    return leftWeight - rightWeight;
  });
}

export default async function TicketsPage({
  searchParams
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { view = 'board' } = await searchParams;

  const supabase = await createClient();

  const [ticketsResult, statusesResult] = await Promise.all([
    supabase
      .from('tickets')
      .select('id,ticket_number,title,status,priority,assigned_agent,updated_at,board_position')
      .order('board_position', { ascending: true })
      .order('updated_at', { ascending: false }),
    supabase.from('ticket_statuses').select('name,position').order('position', { ascending: true })
  ]);

  const tickets = ticketsResult.data ?? [];
  const statuses = statusesResult.data ?? [];
  const sorted = sortByStatus(tickets);

  const showBoard = view === 'board' && statuses.length > 0;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-hidden">
      <nav className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b pb-4">
        <TicketsViewToggle />
      </nav>

      {ticketsResult.error ? (
        <Alert variant="destructive" className="shrink-0">
          <AlertDescription>Failed to load tickets: {ticketsResult.error.message}</AlertDescription>
        </Alert>
      ) : null}

      {showBoard ? (
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
          <KanbanBoard tickets={tickets} statuses={statuses} />
        </div>
      ) : (
        <Card>
          <CardContent className="pt-6">
            <TicketListView tickets={sorted} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
