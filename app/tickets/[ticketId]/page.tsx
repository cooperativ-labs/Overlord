import Link from "next/link";
import { notFound } from "next/navigation";

import { updateTicketStatusAction } from "@/lib/actions/tickets";
import { createClient } from "@/supabase/utils/server";

const statuses = ["draft", "review", "refine", "execute", "deliver", "complete", "blocked"] as const;

type PageProps = {
  params: Promise<{ ticketId: string }>;
};

function buildAttachCommand(ticketNumber: string | null) {
  return `orchestrator attach ${ticketNumber ?? "TICKET-XXXX"}`;
}

export default async function TicketDetailPage({ params }: PageProps) {
  const { ticketId } = await params;
  const supabase = await createClient();

  const [{ data: ticket, error: ticketError }, { data: events }, { data: state }, { data: artifacts }] =
    await Promise.all([
      supabase.from("tickets").select("*").eq("id", ticketId).single(),
      supabase
        .from("ticket_events")
        .select("*")
        .eq("ticket_id", ticketId)
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("shared_state")
        .select("*")
        .eq("ticket_id", ticketId)
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("artifacts")
        .select("*")
        .eq("ticket_id", ticketId)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

  if (ticketError || !ticket) {
    notFound();
  }

  async function transition(formData: FormData) {
    "use server";

    const nextStatus = String(formData.get("status") ?? "");
    await updateTicketStatusAction(ticketId, nextStatus);
  }

  const attachCommand = buildAttachCommand(ticket.ticket_number);
  const chatGptLink = `https://chat.openai.com/?q=${encodeURIComponent(`attach ${ticket.ticket_number ?? ""}`)}`;

  return (
    <div className="grid grid-two">
      <section className="stack">
        <article className="card card-pad">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <h2 style={{ marginTop: 0 }}>
              {ticket.ticket_number} - {ticket.title}
            </h2>
            <Link className="btn btn-ghost" href={`/tickets/${ticketId}/edit`}>
              Edit Ticket
            </Link>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
            <span className="badge">{ticket.status}</span>
            <span className="badge">priority {ticket.priority}</span>
            {ticket.assigned_agent ? <span className="badge">{ticket.assigned_agent}</span> : null}
          </div>

          <div className="stack">
            <div className="kv">
              <strong>Objective</strong>
              <span className="small">{ticket.objective}</span>
            </div>
            <div className="kv">
              <strong>Context</strong>
              <span className="small">{ticket.context || "None provided."}</span>
            </div>
            <div className="kv">
              <strong>Constraints</strong>
              <span className="small">{ticket.constraints || "None provided."}</span>
            </div>
            <div className="kv">
              <strong>Available Tools</strong>
              <span className="small">{ticket.available_tools || "None provided."}</span>
            </div>
            <div className="kv">
              <strong>Acceptance Criteria</strong>
              <span className="small">{ticket.acceptance_criteria || "None provided."}</span>
            </div>
            <div className="kv">
              <strong>Output Format</strong>
              <span className="small">{ticket.output_format || "None provided."}</span>
            </div>
          </div>
        </article>

        <article className="card card-pad">
          <h3 style={{ marginTop: 0 }}>Ticket Events</h3>
          <div className="stack">
            {events?.length ? null : <span className="small muted">No events yet.</span>}
            {events?.map((event) => (
              <article className="ticket-item" key={event.id}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <span className="badge">{event.event_type}</span>
                  {event.phase ? <span className="badge">{event.phase}</span> : null}
                  <span className="small muted">{new Date(event.created_at).toLocaleString()}</span>
                </div>
                <p className="small" style={{ marginBottom: 0 }}>
                  {event.summary || "No summary provided."}
                </p>
              </article>
            ))}
          </div>
        </article>
      </section>

      <aside className="stack">
        <article className="card card-pad">
          <h3 style={{ marginTop: 0 }}>Lifecycle</h3>
          <form action={transition} className="stack">
            <div className="field">
              <label htmlFor="status">Set Status</label>
              <select defaultValue={ticket.status} id="status" name="status">
                {statuses.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </div>
            <button className="btn btn-primary" type="submit">
              Update Status
            </button>
          </form>
        </article>

        <article className="card card-pad">
          <h3 style={{ marginTop: 0 }}>Open In...</h3>
          <div className="stack small">
            <div className="kv">
              <strong>Terminal / Claude Code</strong>
              <code>{attachCommand}</code>
            </div>
            <div className="kv">
              <strong>Claude App</strong>
              <code>{`Attach to ${ticket.ticket_number}`}</code>
            </div>
            <div className="kv">
              <strong>ChatGPT</strong>
              <a className="btn btn-ghost" href={chatGptLink} rel="noreferrer" target="_blank">
                Open prefilled attach prompt
              </a>
            </div>
          </div>
        </article>

        <article className="card card-pad">
          <h3 style={{ marginTop: 0 }}>Shared State</h3>
          <div className="stack small">
            {state?.length ? null : <span className="muted">No shared state entries yet.</span>}
            {state?.map((item) => (
              <div className="kv" key={item.id}>
                <strong>{item.state_key}</strong>
                <code>{JSON.stringify(item.state_value, null, 2)}</code>
              </div>
            ))}
          </div>
        </article>

        <article className="card card-pad">
          <h3 style={{ marginTop: 0 }}>Artifacts</h3>
          <div className="stack small">
            {artifacts?.length ? null : <span className="muted">No artifacts delivered yet.</span>}
            {artifacts?.map((artifact) => (
              <div className="kv" key={artifact.id}>
                <strong>{artifact.label}</strong>
                <span className="muted">{artifact.artifact_type}</span>
                {artifact.uri ? <a href={artifact.uri}>{artifact.uri}</a> : null}
                {artifact.content ? <code>{artifact.content}</code> : null}
              </div>
            ))}
          </div>
        </article>
      </aside>
    </div>
  );
}
