import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent } from '@/components/ui/card';
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
  const statuses =
    columns?.map((col: { name?: string; slug?: string; id?: string; position: number }) => ({
      name: col.name ?? col.slug ?? String(col.id ?? ''),
      position: col.position
    })) ?? [];
  const sorted = sortByStatus(tickets);

  const showBoard = view === 'board' && statuses.length > 0;

  return (
    <div className="flex flex-col gap-4">
      <nav className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
        <div>
          <h1 className="text-lg font-semibold">Ticket Inbox</h1>
          <p className="text-muted-foreground text-sm">
            Drag tickets between columns to change their status.
          </p>
        </div>
        <TicketsViewToggle />
      </nav>

      {ticketsResult.error ? (
        <Alert variant="destructive">
          <AlertDescription>Failed to load tickets: {ticketsResult.error.message}</AlertDescription>
        </Alert>
      ) : null}

      {showBoard ? (
        <KanbanBoard tickets={tickets} statuses={statuses} />
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
