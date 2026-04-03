/**
 * Database types for the mobile app.
 * Derived from the generated Supabase schema in types/database.types.ts.
 */

export type TicketPriority = 'low' | 'medium' | 'high' | 'urgent';
export type TicketExecutionTarget = 'agent' | 'human';
export type LaunchAgentType = 'claude' | 'codex' | 'cursor' | 'gemini' | 'opencode';
export type TicketEventType =
  | 'system'
  | 'question'
  | 'answer'
  | 'update'
  | 'context_write'
  | 'context_read'
  | 'artifact'
  | 'deliver'
  | 'status_change'
  | 'alert'
  | 'user_follow_up'
  | 'ticket_reopened';

export interface AssignedAgent {
  agent?: LaunchAgentType;
  model?: string | null;
  thinking?: string | null;
}

export interface AgentModelSelection {
  agent: LaunchAgentType;
  model: string | null;
  thinking: string | null;
}

export interface AgentModelRecord {
  id: string;
  agent_type: LaunchAgentType;
  model_id: string;
  display_name: string;
  thinking_options: string[];
  is_offered: boolean;
  is_recommended: boolean;
  sort_order: number;
  updated_at: string;
}

/** Subset of feed_posts used in the feed list. */
export interface FeedPost {
  id: string;
  title: string;
  body: string;
  impact_level: string;
  agent_type: string | null;
  tags: string[];
  files_touched: string[];
  human_actions: string[];
  tradeoffs: Array<{
    decision: string;
    alternatives_considered: string;
    rationale: string;
  }>;
  tickets_created: Array<{
    id: string;
    sequence: number;
    title: string;
  }>;
  ticket_id: string;
  created_at: string;
}

/** Subset of tickets used in the tickets list. */
export interface TicketListItem {
  id: string;
  title: string | null;
  status: string;
  priority: TicketPriority;
  execution_target: TicketExecutionTarget;
  assigned_agent: AssignedAgent | null;
  ticket_sequence: number;
  due_datetime: string | null;
  updated_at: string;
}

/** Full ticket detail view. */
export interface TicketDetail {
  id: string;
  title: string | null;
  status: string;
  priority: TicketPriority;
  execution_target: TicketExecutionTarget;
  assigned_agent: AssignedAgent | null;
  due_datetime: string | null;
  ticket_sequence: number;
  context: string;
  constraints: string;
  acceptance_criteria: string | null;
  created_at: string;
  updated_at: string;
  project_id: string;
}

/** Objective linked to a ticket. */
export interface Objective {
  id: string;
  objective: string;
  is_executed: boolean;
  title: string | null;
  state: string;
  agent_identifier: string | null;
  model_identifier: string | null;
  created_at: string;
}

/** A ticket currently being executed by an agent. */
export interface ExecutingFeedTicket {
  id: string;
  project_id: string;
  title: string | null;
  ticket_sequence: number | null;
  project_name: string;
  project_color: string;
  running_agent: string;
  attached_at: string | null;
}

/** Ticket event in the activity timeline. */
export interface TicketEvent {
  id: string;
  event_type: TicketEventType;
  summary: string | null;
  phase: string | null;
  is_blocking: boolean;
  created_at: string;
}

/** SSH server connection status. */
export type ServerStatus = 'pending' | 'connected' | 'error' | 'key_installed';

/** SSH server connection record. */
export interface Server {
  id: string;
  user_id: string;
  organization_id: number;
  label: string;
  host: string;
  port: number;
  username: string;
  ssh_public_key: string | null;
  ssh_key_fingerprint: string | null;
  secure_enclave_tag: string | null;
  key_installed: boolean;
  last_connected_at: string | null;
  status: ServerStatus;
  created_at: string;
  updated_at: string;
}
