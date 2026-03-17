import { z } from 'zod';

import { connectionMethods, ticketExecutionTargets, ticketStatuses } from '@/lib/overlord/types';

const ticketStatusSchema = z.enum(ticketStatuses);
const connectionMethodSchema = z.enum(connectionMethods);
const ticketExecutionTargetSchema = z.enum(ticketExecutionTargets);

/** Accepts a full UUID or an 8-character hex short ID (last 8 chars of UUID). */
const ticketIdSchema = z
  .string()
  .refine(
    v =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ||
      /^[0-9a-f]{8}$/i.test(v),
    'Must be a UUID or 8-character short ID'
  );

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
  ticketId: ticketIdSchema,
  agentIdentifier: z.string().trim().min(1).max(120),
  connectionMethod: connectionMethodSchema.default('rest'),
  externalSessionId: z.string().trim().max(2_048).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional().default({})
});

export const askSchema = z.object({
  sessionKey: z.string().uuid(),
  ticketId: ticketIdSchema,
  question: z.string().trim().min(1).max(20_000),
  phase: ticketStatusSchema.optional(),
  payload: z.record(z.string(), z.unknown()).optional().default({})
});

const updateEventTypeSchema = z
  .enum(['update', 'user_follow_up', 'alert'])
  .optional()
  .default('update');

const changeRationaleHunkSchema = z
  .object({
    header: z.string().trim().min(1).max(240).optional(),
    new_lines: z.number().int().min(0).optional(),
    new_start: z.number().int().min(0).optional(),
    old_lines: z.number().int().min(0).optional(),
    old_start: z.number().int().min(0).optional()
  })
  .refine(
    input =>
      typeof input.header === 'string' ||
      typeof input.new_start === 'number' ||
      typeof input.old_start === 'number',
    {
      error: 'Each hunk needs a header or line range.'
    }
  );

export const changeRationaleSchema = z.object({
  attribution_source: z.string().trim().min(1).max(40).optional().default('explicit'),
  change_kind: z.string().trim().min(1).max(40).optional().default('modify'),
  confidence: z.string().trim().min(1).max(40).optional().default('explicit'),
  file_path: z.string().trim().min(1).max(1024),
  hunks: z.array(changeRationaleHunkSchema).max(20).optional().default([]),
  impact: z.string().trim().min(1).max(2_000),
  label: z.string().trim().min(1).max(160),
  summary: z.string().trim().min(1).max(2_000),
  why: z.string().trim().min(1).max(2_000)
});

export const updateSchema = z.object({
  changeRationales: z.array(changeRationaleSchema).max(50).optional().default([]),
  externalSessionId: z.string().trim().max(2_048).nullable().optional(),
  externalUrl: z.string().trim().max(2_048).pipe(z.url()).nullable().optional(),
  sessionKey: z.string().uuid(),
  ticketId: ticketIdSchema,
  summary: z.string().trim().min(1).max(20_000),
  phase: ticketStatusSchema.optional(),
  eventType: updateEventTypeSchema,
  payload: z.record(z.string(), z.unknown()).optional().default({})
});

export const readContextSchema = z.object({
  sessionKey: z.string().uuid(),
  ticketId: ticketIdSchema,
  query: z.string().trim().max(240).optional().default(''),
  limit: z.number().int().min(1).max(100).optional().default(20)
});

export const writeContextSchema = z.object({
  sessionKey: z.string().uuid(),
  ticketId: ticketIdSchema,
  key: z.string().trim().min(1).max(240),
  value: z.unknown(),
  tags: z.array(z.string().trim().min(1).max(80)).optional().default([])
});

export const deliverSchema = z.object({
  changeRationales: z.array(changeRationaleSchema).max(50).optional().default([]),
  sessionKey: z.string().uuid(),
  ticketId: ticketIdSchema,
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
  ticketId: ticketIdSchema,
  title: z.string().trim().max(180).optional().default(''),
  objective: z.string().trim().min(1).max(20_000),
  availableTools: z.string().trim().max(20_000).optional().default(''),
  acceptanceCriteria: z.string().trim().max(20_000).optional().default(''),
  executionTarget: ticketExecutionTargetSchema.default('human'),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium')
});

/** connect: lightweight session creation, no ticket context returned */
export const connectSchema = z.object({
  ticketId: ticketIdSchema,
  agentIdentifier: z.string().trim().min(1).max(120),
  connectionMethod: connectionMethodSchema.default('rest'),
  metadata: z.record(z.string(), z.unknown()).optional().default({})
});

/** load-context: read-only fetch of ticket details, no session created */
export const loadContextSchema = z.object({
  ticketId: ticketIdSchema
});

/** spawn: create a new ticket and immediately connect to it */
export const spawnSchema = z.object({
  title: z.string().trim().max(180).optional().default(''),
  objective: z.string().trim().min(1).max(20_000),
  acceptanceCriteria: z.string().trim().max(20_000).optional().default(''),
  availableTools: z.string().trim().max(20_000).optional().default(''),
  executionTarget: ticketExecutionTargetSchema.default('agent'),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
  projectId: z.string().optional(),
  agentIdentifier: z.string().trim().min(1).max(120),
  connectionMethod: connectionMethodSchema.default('rest'),
  metadata: z.record(z.string(), z.unknown()).optional().default({})
});

export const artifactPrepareUploadSchema = z.object({
  sessionKey: z.uuid(),
  ticketId: ticketIdSchema,
  fileName: z.string().trim().min(1).max(240),
  label: z.string().trim().max(160).optional(),
  artifactType: z.string().trim().max(80).optional().default('document'),
  contentType: z.string().trim().max(200).optional().default('application/octet-stream'),
  fileSize: z.number().int().min(0).optional(),
  metadata: z.record(z.string(), z.unknown()).optional().default({})
});

export const artifactFinalizeUploadSchema = z.object({
  sessionKey: z.uuid(),
  ticketId: ticketIdSchema,
  storagePath: z.string().trim().min(1).max(1024),
  label: z.string().trim().min(1).max(160),
  artifactType: z.string().trim().max(80).optional().default('document'),
  contentType: z.string().trim().max(200).optional().default('application/octet-stream'),
  fileSize: z.number().int().min(0).optional(),
  metadata: z.record(z.string(), z.unknown()).optional().default({})
});

export const artifactGetDownloadUrlSchema = z
  .object({
    sessionKey: z.uuid(),
    ticketId: ticketIdSchema,
    artifactId: z.uuid().optional(),
    storagePath: z.string().trim().min(1).max(1024).optional(),
    expiresIn: z.number().int().min(60).max(86_400).optional().default(3600)
  })
  .refine(input => Boolean(input.artifactId || input.storagePath), {
    message: 'artifactId or storagePath is required.',
    path: ['artifactId']
  });
