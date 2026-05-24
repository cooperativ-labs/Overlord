export const ticketStatuses = [
  'draft',
  'execute',
  'review',
  'deliver',
  'complete',
  'blocked',
  'cancelled'
] as const;

export type TicketStatus = (typeof ticketStatuses)[number];

export const protocolEventTypes = [
  'system',
  'question',
  'answer',
  'update',
  'user_follow_up',
  'discussion_summary',
  'decision',
  'ticket_reopened',
  'context_write',
  'context_read',
  'artifact',
  'deliver',
  'status_change',
  'alert',
  'awaiting_approval',
  'execution_requested'
] as const;

export const connectionMethods = [
  'mcp',
  'cli',
  'rest',
  'chatgpt',
  'claude_app',
  'claude_code',
  'other'
] as const;

export const ticketExecutionTargets = ['agent', 'human'] as const;
