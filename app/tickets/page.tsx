import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { createClient } from '@/supabase/utils/server';

import KanbanBoard from './(components)/KanbanBoard';
import TicketListView from './(components)/TicketListView';
import TicketsViewToggle from './(components)/TicketsViewToggle';

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

  const [ticketsResult, columnsResult] = await Promise.all([
    supabase
      .from('tickets')
      .select('id,ticket_number,title,status,priority,assigned_agent,updated_at,board_position')
      .order('board_position', { ascending: true })
      .order('updated_at', { ascending: false }),
    supabase.from('board_columns').select('*').order('position', { ascending: true })
  ]);

  const tickets = ticketsResult.data ?? [];
  const columns = columnsResult.data ?? [];
  const sorted = sortByStatus(tickets);

  const showBoard = view === 'board' && columns.length > 0;

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>Ticket Inbox</CardTitle>
              <CardDescription>
                Drag tickets between columns to change their status.
              </CardDescription>
            </div>
            <TicketsViewToggle />
          </div>
        </CardHeader>
      </Card>

      {ticketsResult.error ? (
        <Alert variant="destructive">
          <AlertDescription>Failed to load tickets: {ticketsResult.error.message}</AlertDescription>
        </Alert>
      ) : null}

      {showBoard ? (
        <KanbanBoard tickets={tickets} columns={columns} />
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
