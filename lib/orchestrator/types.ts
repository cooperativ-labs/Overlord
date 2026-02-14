export const ticketStatuses = [
  'draft',
  'review',
  'refine',
  'execute',
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
  'context_write',
  'context_read',
  'artifact',
  'deliver',
  'status_change',
  'alert'
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
