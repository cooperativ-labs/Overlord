// src/tools/create_ticket_draft.ts
import { z } from "zod";
var RESOURCE_URI = "ui://overlord/ticket-card";
var prioritySchema = z.enum(["low", "medium", "high", "urgent"]);
var tool = {
  resource: "ticket-card",
  title: "Create Ticket Draft",
  description: "Turn conversation context into a structured Overlord ticket draft and open an inline editable ticket card.",
  annotations: { readOnlyHint: false },
  _meta: { ui: { visibility: ["model", "app"] } }
};
var schema = {
  conversationContext: z.string().describe("The relevant chat or conversation context to turn into a ticket draft."),
  title: z.string().optional().describe("Optional title override if you already know the best title."),
  description: z.string().optional().describe("Optional description/objective override."),
  priority: prioritySchema.optional().describe("Optional priority override."),
  projectId: z.string().optional().describe("Optional project UUID. Defaults to the first project in your organization.")
};
function summarizeConversation(text) {
  return text.replace(/\s+/g, " ").trim().slice(0, 140);
}
async function create_ticket_draft_default(args, _extra) {
  const description = (args.description?.trim() || args.conversationContext.trim()).trim();
  if (!description) {
    return {
      content: [
        {
          type: "text",
          text: "Conversation context is required to prepare a ticket draft."
        }
      ],
      isError: true
    };
  }
  return {
    content: [
      {
        type: "text",
        text: "Prepared a draft ticket. Review it in the ticket card before saving."
      }
    ],
    structuredContent: {
      draft: {
        title: args.title?.trim() || "New ticket draft",
        description,
        priority: args.priority ?? "medium",
        projectId: args.projectId ?? null,
        projectName: args.projectId ? "Selected project" : "Default project",
        sourceSummary: summarizeConversation(args.conversationContext)
      },
      ticketCard: {
        saveToolName: "save_ticket_draft",
        resourceUri: RESOURCE_URI
      }
    }
  };
}
export {
  create_ticket_draft_default as default,
  schema,
  tool
};
