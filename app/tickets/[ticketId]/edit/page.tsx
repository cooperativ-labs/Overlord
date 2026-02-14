import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { updateTicketAction } from "@/lib/actions/tickets";
import { createClient } from "@/supabase/utils/server";

type PageProps = {
  params: Promise<{ ticketId: string }>;
};

export default async function EditTicketPage({ params }: PageProps) {
  const { ticketId } = await params;
  const supabase = await createClient();

  const { data: ticket, error } = await supabase.from("tickets").select("*").eq("id", ticketId).single();

  if (error || !ticket) {
    notFound();
  }

  async function submit(formData: FormData) {
    "use server";

    await updateTicketAction(ticketId, formData);
    redirect(`/tickets/${ticketId}`);
  }

  return (
    <div className="grid">
      <section className="card card-pad">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ marginTop: 0 }}>Edit Ticket</h2>
          <Link className="btn btn-ghost" href={`/tickets/${ticketId}`}>
            Cancel
          </Link>
        </div>
        <p className="muted small">
          Structured ticket fields are the source of truth for agent execution.
        </p>

        <form action={submit} className="grid" style={{ marginTop: 12 }}>
          <div className="field">
            <label htmlFor="title">Title</label>
            <input defaultValue={ticket.title} id="title" name="title" required />
          </div>

          <div className="field">
            <label htmlFor="objective">Objective</label>
            <textarea defaultValue={ticket.objective} id="objective" name="objective" required />
          </div>

          <div className="field">
            <label htmlFor="context">Context & Reference Files</label>
            <textarea defaultValue={ticket.context ?? ""} id="context" name="context" />
          </div>

          <div className="field">
            <label htmlFor="constraints">Constraints</label>
            <textarea defaultValue={ticket.constraints ?? ""} id="constraints" name="constraints" />
          </div>

          <div className="field">
            <label htmlFor="availableTools">Available Tools</label>
            <textarea defaultValue={ticket.available_tools ?? ""} id="availableTools" name="availableTools" />
          </div>

          <div className="field">
            <label htmlFor="acceptanceCriteria">Acceptance Criteria</label>
            <textarea
              defaultValue={ticket.acceptance_criteria ?? ""}
              id="acceptanceCriteria"
              name="acceptanceCriteria"
            />
          </div>

          <div className="field">
            <label htmlFor="outputFormat">Output Format</label>
            <textarea defaultValue={ticket.output_format ?? ""} id="outputFormat" name="outputFormat" />
          </div>

          <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="field">
              <label htmlFor="assignedAgent">Assigned Agent</label>
              <input
                defaultValue={ticket.assigned_agent ?? ""}
                id="assignedAgent"
                name="assignedAgent"
                placeholder="Claude Code"
              />
            </div>
            <div className="field">
              <label htmlFor="priority">Priority</label>
              <select defaultValue={ticket.priority} id="priority" name="priority">
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button className="btn btn-primary" type="submit">
              Save Changes
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
