import { z } from 'zod';

import { connectionMethods, ticketExecutionTargets, ticketStatuses } from '@/lib/overlord/types';

/**
 * Normalize free-form agent text before storage.
 * - Normalizes line endings to \n so DB content is consistent regardless of agent OS.
 * - Strips null bytes, which PostgreSQL rejects in text columns.
 * Content is never removed or truncated — this is purely structural.
 */
export function normalizeAgentText(s: string): string {
  return s.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\x00').join('');
}

const ticketStatusSchema = z.enum(ticketStatuses);
const connectionMethodSchema = z.enum(connectionMethods);
const ticketExecutionTargetSchema = z.enum(ticketExecutionTargets);

/** Required agent-authored text field with normalization applied after trim. */
const agentText = (max: number) => z.string().trim().min(1).max(max).transform(normalizeAgentText);

/** Optional agent-authored text field with normalization applied after trim. */
const agentTextOptional = (max: number) => z.string().trim().max(max).transform(normalizeAgentText);

const objectiveInputSchema = z.object({
  objective: agentText(20_000),
  title: z.string().trim().max(180).optional(),
  autoAdvance: z.boolean().optional(),
  assignedAgent: z.unknown().optional()
});

const objectivesArrayField = z.array(objectiveInputSchema).min(1).max(50);

/** Accepts a full UUID or a human-readable ticket_id (e.g. "1:899"). */
const ticketIdSchema = z
  .string()
  .refine(
    v =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ||
      /^\d+:\d+$/.test(v),
    'Must be a UUID or ticket_id (e.g. 1:899)'
  );

export const createTicketSchema = z.object({
  title: z.string().trim().max(180).optional().default(''),
  description: agentText(20_000),
  availableTools: agentTextOptional(20_000).optional().default(''),
  acceptanceCriteria: agentTextOptional(20_000).optional().default(''),
  executionTarget: ticketExecutionTargetSchema.default('agent')
});

export const searchTicketsSchema = z.object({
  query: z.string().trim().max(120).optional().default(''),
  includeCompleted: z.boolean().optional().default(false),
  limit: z.number().int().min(1).max(50).optional().default(8),
  statuses: z.array(z.string().trim().max(60)).optional(),
  projectId: z.string().uuid().optional(),
  createdBy: z.string().uuid().optional(),
  updatedAfter: z.string().datetime({ offset: true }).optional(),
  updatedBefore: z.string().datetime({ offset: true }).optional()
});

export const discussObjectiveSchema = z.object({
  ticketId: ticketIdSchema,
  objectiveId: z.string().uuid().optional()
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
  question: agentText(20_000),
  phase: ticketStatusSchema.optional(),
  payload: z.record(z.string(), z.unknown()).optional().default({})
});

export const requestApprovalGateSchema = z.object({
  sessionKey: z.string().uuid(),
  ticketId: ticketIdSchema,
  reason: agentText(2_000),
  objectiveId: z.string().uuid().optional()
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

const snapshotContextSchema = z.object({
  diffStat: z.string().trim().max(20_000).nullable().optional(),
  gitCommitId: z.string().trim().min(1).max(160).nullable().optional(),
  gitRefName: z.string().trim().min(1).max(256).optional(),
  headSha: z.string().trim().min(1).max(160).optional(),
  objectiveId: z.string().trim().min(1).max(64).optional(),
  projectId: z.string().trim().min(1).max(160).optional()
});

const checkpointSchema = z.object({
  diffStat: z.string().trim().max(20_000).nullable().optional(),
  kind: z.enum(['delivery', 'manual', 'objective']).optional().default('delivery'),
  summary: z.string().trim().max(2_000).nullable().optional()
});

export const changeRationaleSchema = z.object({
  attribution_source: z.string().trim().min(1).max(40).optional().default('explicit'),
  change_kind: z.string().trim().min(1).max(40).optional().default('modify'),
  confidence: z.string().trim().min(1).max(40).optional().default('explicit'),
  file_path: z.string().trim().min(1).max(1024),
  hunks: z.array(changeRationaleHunkSchema).max(20).optional().default([]),
  impact: agentText(2_000),
  label: z.string().trim().min(1).max(160),
  objective_id: z.string().uuid().optional(),
  summary: agentText(2_000),
  why: agentText(2_000)
});

export const updateSchema = z.object({
  changeRationales: z.array(changeRationaleSchema).max(50).optional().default([]),
  externalSessionId: z.string().trim().max(2_048).nullable().optional(),
  externalUrl: z.string().trim().max(2_048).pipe(z.url()).nullable().optional(),
  sessionKey: z.string().uuid(),
  snapshot: snapshotContextSchema.optional(),
  ticketId: ticketIdSchema,
  summary: agentText(20_000),
  phase: ticketStatusSchema.optional(),
  eventType: updateEventTypeSchema,
  payload: z.record(z.string(), z.unknown()).optional().default({})
});

export const hookEventSchema = z.object({
  hookType: z.enum(['UserPromptSubmit', 'Stop']),
  ticketId: ticketIdSchema,
  prompt: agentTextOptional(20_000).optional(),
  turnIndex: z.number().int().min(0).optional()
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
  checkpoint: checkpointSchema.optional(),
  sessionKey: z.string().uuid(),
  snapshot: snapshotContextSchema.optional(),
  ticketId: ticketIdSchema,
  summary: agentText(20_000),
  artifacts: z
    .array(
      z.object({
        type: z
          .enum(['next_steps', 'test_results', 'migration', 'decision', 'note', 'url'])
          .describe('Artifact type'),
        label: z.string().trim().min(1).max(160),
        uri: z.string().trim().max(1_024).optional(),
        content: agentTextOptional(100_000).optional(),
        metadata: z.record(z.string(), z.unknown()).optional().default({})
      })
    )
    .optional()
    .default([])
});

export const recordChangeRationalesSchema = z.object({
  changeRationales: z.array(changeRationaleSchema).min(1).max(50),
  sessionKey: z.string().uuid(),
  snapshot: snapshotContextSchema.optional(),
  ticketId: ticketIdSchema,
  summary: agentText(20_000).optional(),
  phase: ticketStatusSchema.optional()
});

export const createStandaloneTicketSchema = z.object({
  title: z.string().trim().max(180).optional().default(''),
  objectives: objectivesArrayField,
  availableTools: agentTextOptional(20_000).optional().default(''),
  acceptanceCriteria: agentTextOptional(20_000).optional().default(''),
  executionTarget: ticketExecutionTargetSchema.default('agent'),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
  projectId: z.string().optional(),
  personal: z.boolean().optional().default(false),
  workingDirectory: z.string().trim().max(1024).optional(),
  delegate: z.string().trim().max(120).optional()
});

export const createFollowUpTicketSchema = z.object({
  sessionKey: z.string().uuid(),
  ticketId: ticketIdSchema,
  title: z.string().trim().max(180).optional().default(''),
  objectives: objectivesArrayField,
  availableTools: agentTextOptional(20_000).optional().default(''),
  acceptanceCriteria: agentTextOptional(20_000).optional().default(''),
  executionTarget: ticketExecutionTargetSchema.default('human'),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
  delegate: z.string().trim().max(120).optional()
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

export const revertSchema = z.object({
  objectiveId: z.uuid()
});

/**
 * record-work: create a completed ticket from chat in one step.
 * Used when an agent has done work directly in a chat (no live session) and
 * wants to record it as a ticket in `review` with a completed objective, then
 * trigger the feed-post generator. Project resolution follows the same
 * workingDirectory → projectId precedence as `prompt`/`create`, but if neither
 * resolves the caller may pass `personal: true` to create a private ticket.
 */
export const recordWorkSchema = z.object({
  title: z.string().trim().max(180).optional().default(''),
  objectives: objectivesArrayField,
  summary: agentText(20_000),
  changeRationales: z.array(changeRationaleSchema).max(50).optional().default([]),
  artifacts: z
    .array(
      z.object({
        type: z
          .enum(['next_steps', 'test_results', 'migration', 'decision', 'note', 'url'])
          .describe('Artifact type'),
        label: z.string().trim().min(1).max(160),
        uri: z.string().trim().max(1_024).optional(),
        content: agentTextOptional(100_000).optional(),
        metadata: z.record(z.string(), z.unknown()).optional().default({})
      })
    )
    .optional()
    .default([]),
  acceptanceCriteria: agentTextOptional(20_000).optional().default(''),
  availableTools: agentTextOptional(20_000).optional().default(''),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
  projectId: z.string().optional(),
  personal: z.boolean().optional().default(false),
  workingDirectory: z.string().trim().max(1024).optional(),
  delegate: z.string().trim().max(120).optional(),
  agentIdentifier: z.string().trim().min(1).max(120),
  connectionMethod: connectionMethodSchema.default('rest'),
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
  deviceFingerprint: z.string().trim().max(128).optional(),
  deviceHostname: z.string().trim().max(256).optional(),
  devicePlatform: z.string().trim().max(64).optional()
});

/** spawn: create a new ticket and immediately connect to it */
export const spawnSchema = z.object({
  title: z.string().trim().max(180).optional().default(''),
  objectives: objectivesArrayField,
  acceptanceCriteria: agentTextOptional(20_000).optional().default(''),
  availableTools: agentTextOptional(20_000).optional().default(''),
  executionTarget: ticketExecutionTargetSchema.default('agent'),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
  projectId: z.string().optional(),
  personal: z.boolean().optional().default(false),
  workingDirectory: z.string().trim().max(1024).optional(),
  delegate: z.string().trim().max(120).optional(),
  parentSessionKey: z.string().uuid().optional(),
  parentTicketId: z.string().optional(),
  agentIdentifier: z.string().trim().min(1).max(120),
  connectionMethod: connectionMethodSchema.default('rest'),
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
  deviceFingerprint: z.string().trim().max(128).optional(),
  deviceHostname: z.string().trim().max(256).optional(),
  devicePlatform: z.string().trim().max(64).optional()
});

export const addObjectivesSchema = z.object({
  ticketId: ticketIdSchema,
  objectives: z.array(objectiveInputSchema).min(1).max(50)
});

/** Optional device-identifying fields accepted on protocol calls. */
const deviceFingerprintSchema = z.string().trim().max(128).optional();
const deviceHostnameSchema = z.string().trim().max(256).optional();
const devicePlatformSchema = z.string().trim().max(64).optional();

/** discover-project: resolve a project from working directory */
export const discoverProjectSchema = z
  .object({
    projectId: z.string().uuid().optional(),
    workingDirectory: z.string().trim().min(1).max(1024).optional(),
    deviceFingerprint: deviceFingerprintSchema,
    deviceHostname: deviceHostnameSchema,
    devicePlatform: devicePlatformSchema
  })
  .refine(input => Boolean(input.projectId || input.workingDirectory), {
    message: 'projectId or workingDirectory is required.',
    path: ['workingDirectory']
  });

export const attachmentPrepareUploadSchema = z.object({
  sessionKey: z.uuid(),
  ticketId: ticketIdSchema.optional(),
  objectiveId: z.uuid(),
  fileName: z.string().trim().min(1).max(240),
  label: z.string().trim().max(160).optional(),
  contentType: z.string().trim().max(200).optional().default('application/octet-stream'),
  fileSize: z.number().int().min(0).optional(),
  metadata: z.record(z.string(), z.unknown()).optional().default({})
});

export const attachmentFinalizeUploadSchema = z.object({
  sessionKey: z.uuid(),
  ticketId: ticketIdSchema.optional(),
  objectiveId: z.uuid(),
  storagePath: z.string().trim().min(1).max(1024),
  label: z.string().trim().min(1).max(160),
  contentType: z.string().trim().max(200).optional().default('application/octet-stream'),
  fileSize: z.number().int().min(0).optional(),
  metadata: z.record(z.string(), z.unknown()).optional().default({})
});

export const attachmentListSchema = z
  .object({
    sessionKey: z.uuid(),
    ticketId: ticketIdSchema.optional(),
    objectiveId: z.uuid().optional()
  })
  .refine(input => Boolean(input.objectiveId || input.ticketId), {
    message: 'objectiveId or ticketId is required.',
    path: ['objectiveId']
  });

export const attachmentGetDownloadUrlSchema = z
  .object({
    sessionKey: z.uuid(),
    ticketId: ticketIdSchema.optional(),
    objectiveId: z.uuid().optional(),
    attachmentId: z.uuid().optional(),
    storagePath: z.string().trim().min(1).max(1024).optional(),
    expiresIn: z.number().int().min(60).max(86_400).optional().default(3600)
  })
  .refine(input => Boolean(input.attachmentId || input.storagePath), {
    message: 'attachmentId or storagePath is required.',
    path: ['attachmentId']
  });

// ---------------------------------------------------------------------------
// Device management
// ---------------------------------------------------------------------------

/** Matches `devices_label_format` in the database. */
export const DEVICE_LABEL_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

/** get-device: identify (and upsert) the calling device */
export const getDeviceSchema = z.object({
  deviceFingerprint: z.string().trim().min(1).max(128),
  deviceHostname: z.string().trim().max(256).optional(),
  devicePlatform: z.string().trim().max(64).optional()
});

/** update-device: rename the device label */
export const updateDeviceSchema = z.object({
  deviceFingerprint: z.string().trim().min(1).max(128),
  label: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(
      DEVICE_LABEL_REGEX,
      'Label must be lowercase kebab-case (letters, numbers, hyphens; 1–64 chars).'
    )
});

// ---------------------------------------------------------------------------
// Project resource directories
// ---------------------------------------------------------------------------

/** list-project-resources: list resource directories for a project */
export const listProjectResourcesSchema = z.object({
  projectId: z.string().uuid(),
  deviceFingerprint: z.string().trim().max(128).optional()
});

/** add-project-resource: register a new directory for a project */
export const addProjectResourceSchema = z.object({
  projectId: z.string().uuid(),
  directoryPath: z.string().trim().min(1).max(1024),
  label: z.string().trim().max(160).optional(),
  isPrimary: z.boolean().optional().default(false),
  deviceFingerprint: z.string().trim().min(1).max(128),
  deviceHostname: z.string().trim().max(256).optional(),
  devicePlatform: z.string().trim().max(64).optional()
});

/** update-project-resource: update path, label, or primary status of a directory */
export const updateProjectResourceSchema = z.object({
  resourceId: z.string().uuid(),
  deviceFingerprint: z.string().trim().min(1).max(128),
  directoryPath: z.string().trim().min(1).max(1024).optional(),
  label: z.string().trim().max(160).nullable().optional(),
  isPrimary: z.boolean().optional()
});

// ---------------------------------------------------------------------------
// Execution requests
// ---------------------------------------------------------------------------

export const executionRequestTargetKindSchema = z.enum(['any', 'local', 'ssh']);
export const executionRequestStatusSchema = z.enum([
  'queued',
  'claimed',
  'launching',
  'launched',
  'failed',
  'cancelled',
  'expired'
]);

export const requestExecutionSchema = z.object({
  ticketId: ticketIdSchema,
  objectiveId: z.string().uuid().optional(),
  requestedFrom: z.string().trim().min(1).max(80).optional().default('api'),
  idempotencyKey: z.string().trim().min(1).max(240).optional(),
  agentIdentifier: z.string().trim().min(1).max(120).optional(),
  modelIdentifier: z.string().trim().max(240).nullable().optional(),
  thinkingLevel: z.string().trim().max(80).nullable().optional(),
  launchMode: z.enum(['run', 'ask']).optional().default('run'),
  flags: z.array(z.string().trim().min(1).max(400)).max(40).optional().default([]),
  workingDirectory: z.string().trim().max(1024).nullable().optional(),
  sshCommand: z.string().trim().max(2048).nullable().optional(),
  remoteWorkingDirectory: z.string().trim().max(1024).nullable().optional(),
  serverMultiplexer: z.enum(['none', 'tmux']).optional(),
  tmuxCommand: z.string().trim().max(1024).nullable().optional(),
  targetKind: executionRequestTargetKindSchema.optional().default('any'),
  targetDeviceId: z.string().uuid().nullable().optional(),
  targetResourceId: z.string().uuid().nullable().optional()
});

export const claimExecutionSchema = z.object({
  deviceFingerprint: z.string().trim().min(1).max(128),
  deviceHostname: z.string().trim().max(256).optional(),
  devicePlatform: z.string().trim().max(64).optional(),
  leaseSeconds: z.number().int().min(30).max(3600).optional().default(300),
  projectId: z.string().uuid().optional()
});

export const completeExecutionLaunchSchema = z.object({
  requestId: z.string().uuid(),
  deviceFingerprint: z.string().trim().min(1).max(128),
  launchedSessionId: z.string().uuid().nullable().optional()
});

export const failExecutionLaunchSchema = z.object({
  requestId: z.string().uuid(),
  deviceFingerprint: z.string().trim().min(1).max(128),
  error: z.string().trim().min(1).max(4000)
});
