import { z } from 'zod';

import { connectionMethods, ticketExecutionTargets, ticketStatuses } from '@/lib/overlord/types';

const ticketStatusSchema = z.enum(ticketStatuses);
const connectionMethodSchema = z.enum(connectionMethods);
const ticketExecutionTargetSchema = z.enum(ticketExecutionTargets);

export const createTicketSchema = z.object({
  title: z.string().trim().max(180).optional().default(''),
  description: z.string().trim().min(1).max(20_000),
  availableTools: z.string().trim().max(20_000).optional().default(''),
  acceptanceCriteria: z.string().trim().max(20_000).optional().default(''),
  executionTarget: ticketExecutionTargetSchema.default('agent')
});

export const listTicketsSchema = z.object({
  includeCompleted: z.boolean().optional().default(true),
  statuses: z.array(ticketStatusSchema).optional()
});

export const attachSchema = z.object({
  ticketId: z.string().uuid(),
  agentIdentifier: z.string().trim().min(1).max(120),
  connectionMethod: connectionMethodSchema.default('rest'),
  metadata: z.record(z.string(), z.unknown()).optional().default({})
});

export const askSchema = z.object({
  sessionKey: z.string().uuid(),
  ticketId: z.string().uuid(),
  question: z.string().trim().min(1).max(20_000),
  phase: ticketStatusSchema.optional(),
  payload: z.record(z.string(), z.unknown()).optional().default({})
});

export const updateSchema = z.object({
  sessionKey: z.string().uuid(),
  ticketId: z.string().uuid(),
  summary: z.string().trim().min(1).max(20_000),
  phase: ticketStatusSchema.optional(),
  payload: z.record(z.string(), z.unknown()).optional().default({})
});

export const decisionSchema = z.object({
  sessionKey: z.string().uuid(),
  ticketId: z.string().uuid(),
  title: z.string().trim().min(1).max(240),
  rationale: z.string().trim().max(20_000).optional().default(''),
  impact: z.string().trim().max(20_000).optional().default(''),
  phase: ticketStatusSchema.optional(),
  payload: z.record(z.string(), z.unknown()).optional().default({})
});

export const readContextSchema = z.object({
  sessionKey: z.string().uuid(),
  ticketId: z.string().uuid(),
  query: z.string().trim().max(240).optional().default(''),
  limit: z.number().int().min(1).max(100).optional().default(20)
});

export const writeContextSchema = z.object({
  sessionKey: z.string().uuid(),
  ticketId: z.string().uuid(),
  key: z.string().trim().min(1).max(240),
  value: z.unknown(),
  tags: z.array(z.string().trim().min(1).max(80)).optional().default([])
});

export const deliverSchema = z.object({
  sessionKey: z.string().uuid(),
  ticketId: z.string().uuid(),
  summary: z.string().trim().min(1).max(20_000),
  artifacts: z
    .array(
      z.object({
        type: z.string().trim().min(1).max(80),
        label: z.string().trim().min(1).max(160),
        uri: z.string().trim().max(1_024).optional(),
        content: z.string().trim().max(100_000).optional(),
        metadata: z.record(z.string(), z.unknown()).optional().default({})
      })
    )
    .optional()
    .default([])
});

export const createStandaloneTicketSchema = z.object({
  title: z.string().trim().max(180).optional().default(''),
  objective: z.string().trim().min(1).max(20_000),
  availableTools: z.string().trim().max(20_000).optional().default(''),
  acceptanceCriteria: z.string().trim().max(20_000).optional().default(''),
  executionTarget: ticketExecutionTargetSchema.default('agent'),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
  projectId: z.string().optional()
});

export const createFollowUpTicketSchema = z.object({
  sessionKey: z.string().uuid(),
  ticketId: z.string().uuid(),
  title: z.string().trim().max(180).optional().default(''),
  objective: z.string().trim().min(1).max(20_000),
  availableTools: z.string().trim().max(20_000).optional().default(''),
  acceptanceCriteria: z.string().trim().max(20_000).optional().default(''),
  executionTarget: ticketExecutionTargetSchema.default('human'),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium')
});
