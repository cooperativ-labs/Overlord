import { z } from 'zod';

export const agentConfigSchema = z.object({
  flags: z.array(z.string()).default([]),
  defaultModel: z.string().optional(),
  lastChosenModel: z.string().optional(),
  permissions: z.record(z.string(), z.boolean()).optional()
});

export type AgentConfig = z.infer<typeof agentConfigSchema>;

export const userAgentConfigSchema = z.object({
  id: z.uuid(),
  user_id: z.uuid(),
  agent_type: z.string(),
  config: agentConfigSchema,
  created_at: z.date(),
  updated_at: z.date()
});

export type UserAgentConfig = z.infer<typeof userAgentConfigSchema>;
