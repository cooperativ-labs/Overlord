import { z } from 'zod';

/** Reserved agent_type row that stores the user's custom agent definitions. */
export const CUSTOM_AGENTS_CONFIG_KEY = '__custom__';

export const customAgentOptionSchema = z.object({
  value: z.string(),
  label: z.string()
});

export type CustomAgentOption = z.infer<typeof customAgentOptionSchema>;

export const customAgentPlaceholderSchema = z.object({
  /** Token matched as {{token}} in the command template. */
  token: z.string(),
  /** Column header shown for this placeholder in the model selector. */
  label: z.string(),
  /** Which selector column this placeholder drives. */
  role: z.enum(['model', 'thinking', 'other']).default('other'),
  options: z.array(customAgentOptionSchema).default([])
});

export type CustomAgentPlaceholder = z.infer<typeof customAgentPlaceholderSchema>;

export const customAgentSchema = z.object({
  /** Stable slug, unique per user. */
  id: z.string(),
  /** Display name shown in the selector. */
  name: z.string(),
  /** Launch template, e.g. "ollama claude {{model}} --effort {{effort}}". */
  commandTemplate: z.string(),
  placeholders: z.array(customAgentPlaceholderSchema).default([])
});

export type CustomAgent = z.infer<typeof customAgentSchema>;

export const agentConfigSchema = z.object({
  flags: z.array(z.string()).default([]),
  /** Tokens prepended before the agent binary, e.g. "ollama" to run via Ollama. */
  preCommand: z.string().optional(),
  defaultModel: z.string().optional(),
  defaultThinking: z.string().optional(),
  lastChosenModel: z.string().optional(),
  permissions: z.record(z.string(), z.boolean()).optional(),
  /** User has hidden this built-in agent from their model selector. */
  hidden: z.boolean().optional(),
  /** Offered model_ids the user has hidden from their model selector. */
  hiddenModels: z.array(z.string()).optional(),
  /** Only populated on the reserved CUSTOM_AGENTS_CONFIG_KEY row. */
  customAgents: z.array(customAgentSchema).optional()
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
