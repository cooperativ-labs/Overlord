import { createClient } from '@/supabase/utils/server';

import KanbanBoard from './_components/KanbanBoard';
import TicketListView from './_components/TicketListView';
import TicketsViewToggle from './_components/TicketsViewToggle';

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
    <div className="grid" style={{ gap: 18 }}>
      <section className="card card-pad">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h2 style={{ marginTop: 0, marginBottom: 4 }}>Ticket Inbox</h2>
            <p className="muted small" style={{ margin: 0 }}>
              Drag tickets between columns to change their status.
            </p>
          </div>
          <TicketsViewToggle />
        </div>
      </section>

      {ticketsResult.error ? (
        <article className="notice">Failed to load tickets: {ticketsResult.error.message}</article>
      ) : null}

      {showBoard ? (
        <KanbanBoard tickets={tickets} columns={columns} />
      ) : (
        <TicketListView tickets={sorted} />
      )}
    </div>
  );
}
