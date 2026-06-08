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

export type TicketListItemRow = Omit<
  TicketListItem,
  'execution_target' | 'assigned_agent' | 'has_executing_objective'
> & {
  for_human: boolean;
};

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
  everhour_task_id: string | null;
  assigned_member: string | null;
}

export type TicketDetailRow = Omit<TicketDetail, 'execution_target'> & {
  for_human: boolean;
};

type TicketExecutionTargetRow = {
  for_human: boolean | null | undefined;
};

export function executionTargetFromForHuman(
  forHuman: TicketExecutionTargetRow['for_human']
): TicketExecutionTarget {
  return forHuman ? 'human' : 'agent';
}

export function normalizeTicketExecutionTarget<T extends TicketExecutionTargetRow>(
  ticket: T
): Omit<T, 'for_human'> & { execution_target: TicketExecutionTarget } {
  const { for_human, ...rest } = ticket;
  return {
    ...rest,
    execution_target: executionTargetFromForHuman(for_human)
  };
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
  /**
   * Per-objective override of the execution target's agent launch config
   * (pre-command + flags), set from the AgentLaunchFooter. `null` means no
   * override (inherit the target config); a present value — even with empty
   * fields — overrides it for this objective.
   */
  launch_config: AgentLaunchConfig | null;
  position: number;
  auto_advance: boolean;
  approval_reason: string | null;
  auto_advanced_at: string | null;
  created_at: string;
}

export type AgentSessionState = 'attached' | 'idle' | 'blocked' | 'completed' | 'disconnected';

export interface TicketAgentSessionSummary {
  objective_id: string;
  session_state: AgentSessionState;
  agent_identifier: string;
  attached_at: string | null;
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

/** Per-agent local launch configuration stored on an execution target. */
export interface AgentLaunchConfig {
  /** Command flags appended when launching this agent on the target. */
  flags: string[];
  /** Tokens prepended before the agent binary (e.g. a container exec wrapper). */
  preCommand: string | null;
}

/**
 * Partial update for an agent's per-target launch config. An omitted field is
 * left unchanged; `preCommand: null` (or blank) clears a stored pre-command.
 */
export interface AgentLaunchConfigUpdate {
  flags?: string[];
  preCommand?: string | null;
}

/**
 * An execution target the ovld runner can claim work on. Replaces the legacy
 * per-device SSH "server" model — the app no longer connects to machines
 * directly; it queues work that a runner attached to the target picks up.
 */
export interface ExecutionTarget {
  /** execution_targets.id */
  id: string;
  /** organization_execution_targets.label — the user-facing slug. */
  label: string;
  organizationId: number;
  host: string;
  port: number;
  /** 'local' | 'ssh' | 'tailscale_ssh' */
  transport: string;
  platform: string | null;
  name: string | null;
  isPlaceholder: boolean;
  lastSeenAt: string | null;
  /** user_execution_targets.access_status — null when the user has no row. */
  accessStatus: string | null;
  defaultUsername: string | null;
  /** Per-agent default pre-commands and flags, keyed by agent_type. */
  agentFlags: Record<string, AgentLaunchConfig>;
}
