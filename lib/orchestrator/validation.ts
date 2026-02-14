import { z } from "zod";

import { connectionMethods, ticketStatuses } from "@/lib/orchestrator/types";

const ticketStatusSchema = z.enum(ticketStatuses);
const connectionMethodSchema = z.enum(connectionMethods);

export const createTicketSchema = z.object({
  title: z.string().trim().min(3).max(180),
  objective: z.string().trim().min(1),
  context: z.string().trim().max(20_000).optional().default(""),
  constraints: z.string().trim().max(20_000).optional().default(""),
  availableTools: z.string().trim().max(20_000).optional().default(""),
  acceptanceCriteria: z.string().trim().max(20_000).optional().default(""),
  outputFormat: z.string().trim().max(20_000).optional().default(""),
  assignedAgent: z.string().trim().max(120).optional().default(""),
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
});

export const listTicketsSchema = z.object({
  includeCompleted: z.boolean().optional().default(true),
  statuses: z.array(ticketStatusSchema).optional(),
});

export const attachSchema = z.object({
  ticketId: z.string().uuid(),
  agentIdentifier: z.string().trim().min(1).max(120),
  connectionMethod: connectionMethodSchema.default("rest"),
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
});

export const askSchema = z.object({
  sessionKey: z.string().uuid(),
  ticketId: z.string().uuid(),
  question: z.string().trim().min(1).max(20_000),
  phase: ticketStatusSchema.optional(),
  payload: z.record(z.string(), z.unknown()).optional().default({}),
});

export const updateSchema = z.object({
  sessionKey: z.string().uuid(),
  ticketId: z.string().uuid(),
  summary: z.string().trim().min(1).max(20_000),
  phase: ticketStatusSchema.optional(),
  payload: z.record(z.string(), z.unknown()).optional().default({}),
});

export const readContextSchema = z.object({
  sessionKey: z.string().uuid(),
  ticketId: z.string().uuid(),
  query: z.string().trim().max(240).optional().default(""),
  limit: z.number().int().min(1).max(100).optional().default(20),
});

export const writeContextSchema = z.object({
  sessionKey: z.string().uuid(),
  ticketId: z.string().uuid(),
  key: z.string().trim().min(1).max(240),
  value: z.unknown(),
  tags: z.array(z.string().trim().min(1).max(80)).optional().default([]),
});

export const createBoardColumnSchema = z.object({
  title: z.string().trim().min(1).max(120),
  slug: z.string().trim().min(1).max(60),
  statuses: z.array(z.string().trim().min(1)).min(1),
  position: z.number().int().min(0),
});

export const updateBoardColumnSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  slug: z.string().trim().min(1).max(60).optional(),
  statuses: z.array(z.string().trim().min(1)).min(1).optional(),
  position: z.number().int().min(0).optional(),
});

export const reorderBoardColumnsSchema = z.object({
  orderedIds: z.array(z.string().uuid()).min(1),
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
        metadata: z.record(z.string(), z.unknown()).optional().default({}),
      })
    )
    .optional()
    .default([]),
});
