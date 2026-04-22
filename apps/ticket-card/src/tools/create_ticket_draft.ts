import type { AppToolConfig, ToolHandlerExtra } from 'sunpeak/mcp';
import { z } from 'zod';

const RESOURCE_URI = 'ui://overlord/ticket-card';

const prioritySchema = z.enum(['low', 'medium', 'high', 'urgent']);

export const tool: AppToolConfig = {
  resource: 'ticket-card',
  title: 'Create Ticket Draft',
  description:
    'Turn conversation context into a structured Overlord ticket draft and open an inline editable ticket card.',
  annotations: { readOnlyHint: false },
  _meta: { ui: { visibility: ['model', 'app'] } }
};

export const schema = {
  conversationContext: z
    .string()
    .describe('The relevant chat or conversation context to turn into a ticket draft.'),
  title: z
    .string()
    .optional()
    .describe('Optional title override if you already know the best title.'),
  description: z.string().optional().describe('Optional description/objective override.'),
  priority: prioritySchema.optional().describe('Optional priority override.'),
  projectId: z.string().optional().describe('Optional project UUID. Omit for a personal ticket.'),
  personal: z.boolean().optional().describe('Create this as a personal ticket without a project.')
};

type Args = z.infer<z.ZodObject<typeof schema>>;

function summarizeConversation(text: string) {
  return text.replace(/\s+/g, ' ').trim().slice(0, 140);
}

export default async function (args: Args, _extra: ToolHandlerExtra) {
  const description = (args.description?.trim() || args.conversationContext.trim()).trim();
  if (!description) {
    return {
      content: [
        {
          type: 'text' as const,
          text: 'Conversation context is required to prepare a ticket draft.'
        }
      ],
      isError: true
    };
  }

  return {
    content: [
      {
        type: 'text' as const,
        text: 'Prepared a draft ticket. Review it in the ticket card before saving.'
      }
    ],
    structuredContent: {
      draft: {
        title: args.title?.trim() || 'New ticket draft',
        description,
        priority: args.priority ?? 'medium',
        projectId: args.projectId ?? null,
        projectName: args.personal || !args.projectId ? 'Personal' : 'Selected project',
        sourceSummary: summarizeConversation(args.conversationContext)
      },
      ticketCard: {
        saveToolName: 'save_ticket_draft',
        resourceUri: RESOURCE_URI
      }
    }
  };
}
