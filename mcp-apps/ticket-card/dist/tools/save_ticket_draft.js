// src/tools/save_ticket_draft.ts
import { z } from "zod";
var prioritySchema = z.enum(["low", "medium", "high", "urgent"]);
var tool = {
  title: "Save Ticket Draft",
  description: "Persist a reviewed Overlord ticket draft after the user confirms the final fields.",
  annotations: { readOnlyHint: false },
  _meta: { ui: { visibility: ["model", "app"] } }
};
var schema = {
  title: z.string().min(1).describe("Ticket title."),
  description: z.string().min(1).describe("Ticket objective or description."),
  priority: prioritySchema.describe("Selected priority."),
  projectId: z.string().optional().describe("Optional project UUID.")
};
async function save_ticket_draft_default(args, _extra) {
  const ticketId = crypto.randomUUID();
  const reference = `OVLD-${ticketId.slice(0, 8).toUpperCase()}`;
  return {
    content: [{ type: "text", text: `Created Overlord ticket ${reference}.` }],
    structuredContent: {
      ticket: {
        id: ticketId,
        reference,
        title: args.title,
        projectName: args.projectId ? "Selected project" : "Default project"
      }
    }
  };
}
export {
  save_ticket_draft_default as default,
  schema,
  tool
};
