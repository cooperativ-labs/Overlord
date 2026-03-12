/**
 * Canonical Zod schemas for Overlord protocol payloads.
 * These schemas are the single source of truth for all protocol communication.
 * Used for:
 * - Validating incoming requests from agents
 * - Generating prompt documentation
 * - Type checking in client code
 */
import { z } from 'zod';

// Shared types
export const ChangeRationale = z.object({
  label: z.string().describe('Short reviewer-facing title'),
  file_path: z.string().describe('Path to the file that changed'),
  summary: z.string().describe('What changed'),
  why: z.string().describe('Why it changed'),
  impact: z.string().describe('Behavioral or review impact'),
  hunks: z
    .array(
      z.object({
        header: z.string().describe('Unified diff hunk header, e.g. @@ -10,6 +10,14 @@')
      })
    )
    .optional()
});
export type ChangeRationale = z.infer<typeof ChangeRationale>;

export const Artifact = z.object({
  type: z.enum(['file_changes', 'next_steps', 'test_results', 'migration', 'note', 'url']),
  label: z.string().describe('Display name for this artifact'),
  content: z.string().describe('Artifact content or summary')
});
export type Artifact = z.infer<typeof Artifact>;

export const EventType = z
  .enum(['update', 'user_follow_up', 'alert'])
  .default('update')
  .describe('Type of activity event to publish');

export const Phase = z
  .enum(['draft', 'execute', 'review', 'deliver', 'complete', 'blocked', 'cancelled'])
  .default('execute');

// Protocol Payloads

export const AttachPayload = z.object({
  ticketId: z.string().describe('Target ticket ID'),
  agentIdentifier: z.string().describe('Agent name or identifier, e.g. "claude-code", "codex"'),
  connectionMethod: z
    .string()
    .describe('How the agent is connecting: "mcp", "cli", "rest", etc.'),
  metadata: z.record(z.any()).optional().describe('Optional agent-specific metadata')
});
export type AttachPayload = z.infer<typeof AttachPayload>;

export const UpdatePayload = z.object({
  sessionKey: z.string().describe('Session key from attach response'),
  ticketId: z.string().describe('Target ticket ID'),
  summary: z.string().describe('Human-readable summary of what was done'),
  phase: Phase.optional(),
  eventType: EventType.optional(),
  changeRationales: z
    .array(ChangeRationale)
    .optional()
    .describe('Only for meaningful behavioral changes; skip formatting-only noise'),
  payload: z
    .object({
      notifications: z
        .array(
          z.object({
            message: z.string(),
            kind: z.enum(['question', 'event']).optional(),
            blocking: z.boolean().optional(),
            level: z.enum(['info', 'warning', 'error']).optional()
          })
        )
        .optional()
    })
    .optional()
    .describe('Optional notifications to surface in UI')
});
export type UpdatePayload = z.infer<typeof UpdatePayload>;

export const AskPayload = z.object({
  sessionKey: z.string().describe('Session key from attach response'),
  ticketId: z.string().describe('Target ticket ID'),
  question: z.string().describe('Blocking question for the human PM'),
  phase: Phase.optional().default('review')
});
export type AskPayload = z.infer<typeof AskPayload>;

export const ReadContextPayload = z.object({
  sessionKey: z.string().describe('Session key from attach response'),
  ticketId: z.string().describe('Target ticket ID'),
  query: z.string().optional().describe('Optional key filter'),
  limit: z.number().int().optional().default(20).describe('Maximum keys to return')
});
export type ReadContextPayload = z.infer<typeof ReadContextPayload>;

export const WriteContextPayload = z.object({
  sessionKey: z.string().describe('Session key from attach response'),
  ticketId: z.string().describe('Target ticket ID'),
  key: z.string().describe('Unique key for this context entry'),
  value: z.any().describe('JSON value to persist'),
  tags: z.array(z.string()).optional().describe('Optional tags for organizing context')
});
export type WriteContextPayload = z.infer<typeof WriteContextPayload>;

export const ArtifactPrepareUploadPayload = z.object({
  sessionKey: z.string().describe('Session key from attach response'),
  ticketId: z.string().describe('Target ticket ID'),
  filename: z.string().describe('Name of the file to upload'),
  contentType: z.string().describe('MIME type, e.g. "application/pdf"'),
  size: z.number().int().describe('File size in bytes')
});
export type ArtifactPrepareUploadPayload = z.infer<typeof ArtifactPrepareUploadPayload>;

export const ArtifactFinalizeUploadPayload = z.object({
  sessionKey: z.string().describe('Session key from attach response'),
  ticketId: z.string().describe('Target ticket ID'),
  uploadId: z.string().describe('Upload ID from prepare response'),
  label: z.string().describe('Human-readable label for this artifact')
});
export type ArtifactFinalizeUploadPayload = z.infer<typeof ArtifactFinalizeUploadPayload>;

export const ArtifactGetDownloadUrlPayload = z.object({
  sessionKey: z.string().describe('Session key from attach response'),
  ticketId: z.string().describe('Target ticket ID'),
  artifactId: z.string().describe('Artifact ID to download')
});
export type ArtifactGetDownloadUrlPayload = z.infer<typeof ArtifactGetDownloadUrlPayload>;

export const CreateTicketPayload = z.object({
  sessionKey: z.string().describe('Session key from attach response'),
  ticketId: z.string().describe('Parent ticket ID'),
  title: z.string().describe('Title for the follow-up ticket'),
  objective: z.string().describe('What needs to be done'),
  acceptanceCriteria: z
    .string()
    .describe('How to verify the work is complete'),
  executionTarget: z.enum(['human', 'agent']).describe('Who should execute this ticket')
});
export type CreateTicketPayload = z.infer<typeof CreateTicketPayload>;

export const DeliverPayload = z.object({
  sessionKey: z.string().describe('Session key from attach response'),
  ticketId: z.string().describe('Target ticket ID'),
  summary: z.string().describe('Narrative summary of what was done and next steps'),
  changeRationales: z
    .array(ChangeRationale)
    .optional()
    .describe('Meaningful behavioral changes only'),
  artifacts: z
    .array(Artifact)
    .optional()
    .describe('Deliverables and supplementary artifacts')
});
export type DeliverPayload = z.infer<typeof DeliverPayload>;

// Union of all protocol payloads for validation
export const ProtocolPayload = z.union([
  AttachPayload,
  UpdatePayload,
  AskPayload,
  ReadContextPayload,
  WriteContextPayload,
  ArtifactPrepareUploadPayload,
  ArtifactFinalizeUploadPayload,
  ArtifactGetDownloadUrlPayload,
  CreateTicketPayload,
  DeliverPayload
]);
export type ProtocolPayload = z.infer<typeof ProtocolPayload>;
