import Link from "next/link";

import { createClient } from "@/lib/supabase/server";

const statusOrder = [
  "draft",
  "review",
  "refine",
  "execute",
  "deliver",
  "complete",
  "blocked",
  "cancelled",
];

function sortByStatus<T extends { status: string }>(items: T[]): T[] {
  const statusWeight = new Map(statusOrder.map((status, index) => [status, index]));
  return [...items].sort((left, right) => {
    const leftWeight = statusWeight.get(left.status) ?? 999;
    const rightWeight = statusWeight.get(right.status) ?? 999;
    if (leftWeight !== rightWeight) {
      return leftWeight - rightWeight;
    }
    return 0;
  });
}

export default async function TicketsPage() {
  const supabase = await createClient();
  const { data: tickets, error } = await supabase
    .from("tickets")
    .select("id,ticket_number,title,status,priority,assigned_agent,updated_at")
    .order("updated_at", { ascending: false });

  const sorted = sortByStatus(tickets ?? []);

  return (
    <div className="grid" style={{ gap: 18 }}>
      <section className="card card-pad">
        <h2 style={{ marginTop: 0 }}>Ticket Inbox</h2>
        <p className="muted small" style={{ marginTop: 8 }}>
          Chat is intentionally deferred for MVP. This dashboard focuses on ticket specs, protocol
          events, and attach flows for external agent runtimes.
        </p>
      </section>

      <section className="ticket-list">
        {error ? (
          <article className="notice">Failed to load tickets: {error.message}</article>
        ) : null}
        {!sorted.length && !error ? (
          <article className="card card-pad">No tickets yet. Create the first one.</article>
        ) : null}
        {sorted.map((ticket) => (
          <article className="ticket-item" key={ticket.id}>
            <h3>
              <Link href={`/tickets/${ticket.id}`}>
                {ticket.ticket_number ?? "TICKET-????"} - {ticket.title}
              </Link>
            </h3>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <span className="badge">{ticket.status}</span>
              <span className="badge">priority {ticket.priority}</span>
              {ticket.assigned_agent ? <span className="badge">{ticket.assigned_agent}</span> : null}
              <span className="small muted">
                updated {new Date(ticket.updated_at).toLocaleString()}
              </span>
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
