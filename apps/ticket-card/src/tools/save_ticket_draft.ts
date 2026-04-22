import type { AppToolConfig, ToolHandlerExtra } from 'sunpeak/mcp';
import { z } from 'zod';

const prioritySchema = z.enum(['low', 'medium', 'high', 'urgent']);

export const tool: AppToolConfig = {
  title: 'Save Ticket Draft',
  description: 'Persist a reviewed Overlord ticket draft after the user confirms the final fields.',
  annotations: { readOnlyHint: false },
  _meta: { ui: { visibility: ['model', 'app'] } }
};

export const schema = {
  title: z.string().min(1).describe('Ticket title.'),
  description: z.string().min(1).describe('Ticket objective or description.'),
  priority: prioritySchema.describe('Selected priority.'),
  projectId: z.string().optional().describe('Optional project UUID.')
};

type Args = z.infer<z.ZodObject<typeof schema>>;

export default async function (args: Args, _extra: ToolHandlerExtra) {
  const ticketId = crypto.randomUUID();
  const reference = `OVLD-${ticketId.slice(0, 8).toUpperCase()}`;

  return {
    content: [{ type: 'text' as const, text: `Created Overlord ticket ${reference}.` }],
    structuredContent: {
      ticket: {
        id: ticketId,
        reference,
        title: args.title,
        projectName: args.projectId ? 'Selected project' : 'Personal'
      }
    }
  };
}
