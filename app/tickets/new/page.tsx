import { redirect } from "next/navigation";

import { createTicketAction } from "@/lib/actions/tickets";

export default function NewTicketPage() {
  async function submit(formData: FormData) {
    "use server";

    const { id } = await createTicketAction(formData);
    redirect(`/tickets/${id}`);
  }

  return (
    <div className="grid">
      <section className="card card-pad">
        <h2 style={{ marginTop: 0 }}>Create Ticket</h2>
        <p className="muted small">
          Structured ticket fields are the source of truth for agent execution.
        </p>

        <form action={submit} className="grid" style={{ marginTop: 12 }}>
          <div className="field">
            <label htmlFor="title">Title</label>
            <input id="title" name="title" required />
          </div>

          <div className="field">
            <label htmlFor="objective">Objective</label>
            <textarea id="objective" name="objective" required />
          </div>

          <div className="field">
            <label htmlFor="context">Context & Reference Files</label>
            <textarea id="context" name="context" />
          </div>

          <div className="field">
            <label htmlFor="constraints">Constraints</label>
            <textarea id="constraints" name="constraints" />
          </div>

          <div className="field">
            <label htmlFor="availableTools">Available Tools</label>
            <textarea id="availableTools" name="availableTools" />
          </div>

          <div className="field">
            <label htmlFor="acceptanceCriteria">Acceptance Criteria</label>
            <textarea id="acceptanceCriteria" name="acceptanceCriteria" />
          </div>

          <div className="field">
            <label htmlFor="outputFormat">Output Format</label>
            <textarea id="outputFormat" name="outputFormat" />
          </div>

          <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="field">
              <label htmlFor="assignedAgent">Assigned Agent</label>
              <input id="assignedAgent" name="assignedAgent" placeholder="Claude Code" />
            </div>
            <div className="field">
              <label htmlFor="priority">Priority</label>
              <select defaultValue="medium" id="priority" name="priority">
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button className="btn btn-primary" type="submit">
              Save Ticket
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
