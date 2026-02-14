export const ticketStatuses = [
  "draft",
  "review",
  "refine",
  "execute",
  "deliver",
  "complete",
  "blocked",
  "cancelled",
] as const;

export type TicketStatus = (typeof ticketStatuses)[number];

export const protocolEventTypes = [
  "system",
  "question",
  "answer",
  "update",
  "context_write",
  "context_read",
  "artifact",
  "deliver",
  "status_change",
  "alert",
] as const;

export type BoardColumn = {
  id: string;
  title: string;
  slug: string;
  statuses: string[];
  position: number;
  created_at: string;
  updated_at: string;
};

export const connectionMethods = [
  "mcp",
  "cli",
  "rest",
  "chatgpt",
  "claude_app",
  "claude_code",
  "other",
] as const;
