import type { LaunchAgentType } from '@/lib/helpers/agent-types';
import type { EffectiveTicketTag } from '@/types/tags';

import { Database } from './database.types';
import { SessionStateEnum } from './sessions';

export type TicketAssignedAgent = {
  agent: LaunchAgentType;
  model: string | null;
  thinking: string | null;
  customAgentId?: string | null;
};

export type TicketType = Database['public']['Tables']['tickets']['Row'];

export type TicketAssignee = {
  memberId: string;
  name: string | null;
  username: string | null;
  imageUrl: string | null;
};

export type Ticket = {
  id: string;
  ticket_id: string | null;
  ticket_sequence?: number | null;
  title: string | null;
  objective: string | null;
  organization_id: number;
  project_id: string | null;
  project_name?: string | null;
  project_color?: string | null;
  project_everhour_project_id?: string | null;
  everhour_task_id?: string | null;
  agent_session_state?: SessionStateEnum | null;
  running_agent?: string | null;
  latest_objective_agent?: string | null;
  has_executing_objective?: boolean;
  status: string;
  priority: string;
  for_human: boolean;
  assigned_agent: TicketAssignedAgent | null;
  board_position: number;
  organization_name?: string | null;
  waiting_for_response_at?: string | null;
  has_unopened_waiting_response?: boolean;
  is_read?: boolean;
  objectives_executed_count?: number;
  has_draft_objective_with_text?: boolean;
  updated_at?: string;
  delegate?: string | null;
  schedule_id?: number | null;
  due_datetime?: string | null;
  tags?: EffectiveTicketTag[];
  assigned_member?: string | null;
  assignee?: TicketAssignee | null;
};
