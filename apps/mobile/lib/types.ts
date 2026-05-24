/**
 * Database types for the mobile app.
 * Derived from the generated Supabase schema in types/database.types.ts.
 */

export type TicketPriority = 'low' | 'medium' | 'high' | 'urgent';
export type TicketExecutionTarget = 'agent' | 'human';
export type LaunchAgentType = 'claude' | 'codex' | 'cursor' | 'antigravity' | 'opencode' | 'pi';
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
  | 'ticket_reopened'
  | 'awaiting_approval'
  | 'auto_advance'
  | 'execution_requested'
  | 'execution_launch_failed';

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
  project_id: string;
  title: string;
  summary: string;
  body: string;
  impact_level: string;
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
    reference?: string | null;
    sequence: number;
    title: string;
  }>;
  objective_sections: unknown[];
  orphan_file_changes: unknown[];
  total_events: number;
  total_files: number;
  pending_actions: number;
  ticket_title: string | null;
  ticket_sequence: number | null;
  project_name: string;
  project_color: string;
  ticket_id: string;
  created_at: string;
  updated_at: string;
}

/** Subset of tickets used in the tickets list. */
export interface TicketListItem {
  id: string;
  title: string | null;
  organization_id: number;
  status: string;
  priority: TicketPriority;
  execution_target: TicketExecutionTarget;
  assigned_agent: AssignedAgent | null;
  ticket_sequence: number;
  due_datetime: string | null;
  updated_at: string;
  has_executing_objective?: boolean;
}

/** Full ticket detail view. */
export interface TicketDetail {
  id: string;
  ticket_id: string | null;
  organization_id: number;
  title: string | null;
  status: string;
  priority: TicketPriority;
  execution_target: TicketExecutionTarget;
  due_datetime: string | null;
  ticket_sequence: number;
  context: string;
  constraints: string;
  acceptance_criteria: string | null;
  created_at: string;
  updated_at: string;
  project_id: string | null;
}

/** Objective linked to a ticket. */
export interface Objective {
  id: string;
  objective: string;
  title: string | null;
  state: 'draft' | 'future' | 'submitted' | 'executing' | 'pending_delivery' | 'complete';
  agent_identifier: string | null;
  model_identifier: string | null;
  assigned_agent: AssignedAgent | null;
  position: number;
  auto_advance: boolean;
  approval_reason: string | null;
  auto_advanced_at: string | null;
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
  created_by: string | null;
}

/** Supported remote connection transports. */
export type ServerTransport = 'ssh' | 'tailscale_ssh';

/** SSH server connection status. */
export type ServerStatus = 'pending' | 'connected' | 'error';

/** Device-local credential metadata for a server profile. */
export interface DeviceServerCredential {
  serverId: string;
  keyTag: string;
  publicKey: string;
  publicKeyFingerprint: string;
  isHardwareBacked: boolean;
  createdAt: string;
}

/** SSH server connection record. */
export interface Server {
  id: string;
  user_id: string;
  organization_id: number;
  label: string;
  host: string;
  port: number;
  username: string;
  transport: ServerTransport;
  host_key_fingerprint: string | null;
  last_connected_at: string | null;
  last_verified_at: string | null;
  last_error: string | null;
  status: ServerStatus;
  created_at: string;
  updated_at: string;
}
