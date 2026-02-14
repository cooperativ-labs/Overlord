import Link from "next/link";

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
      <article className="card card-pad">No tickets yet. Create the first one.</article>
    );
  }

  return (
    <section className="ticket-list">
      {tickets.map((ticket) => (
        <article className="ticket-item" key={ticket.id}>
          <h3>
            <Link href={`/tickets/${ticket.id}`}>
              {ticket.ticket_number ?? "TICKET-????"} - {ticket.title}
            </Link>
          </h3>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <span className="badge">{ticket.status}</span>
            <span className="badge">priority {ticket.priority}</span>
            {ticket.assigned_agent ? (
              <span className="badge">{ticket.assigned_agent}</span>
            ) : null}
            <span className="small muted">
              updated {new Date(ticket.updated_at).toLocaleString()}
            </span>
          </div>
        </article>
      ))}
    </section>
  );
}
