import {
  type AutoAdvanceLaunchContext,
  buildAutoAdvanceLaunchParams,
  fetchAgentFlagsByUserId,
  getAutoAdvanceObjectiveId,
  resolveAssignedAgentFromAutoAdvancePayload,
  resolveLaunchAgentForAutoAdvance,
  resolveWorkingDirectoryFromProject
} from '@/lib/auto-advance/resolve-auto-advance-launch';
import { getTicketIdentifier } from '@/lib/helpers/tickets';
import { createClient } from '@/supabase/utils/client';
import type { Database } from '@/types/database.types';
import type { LaunchTerminalAgentParams } from '@/types/electron';

type TicketEvent = Database['public']['Tables']['ticket_events']['Row'];

export type HandleAutoAdvanceEventInput = {
  event: TicketEvent;
  launchAgent: (params: LaunchTerminalAgentParams) => Promise<void>;
  localWorkingDirectoryByProjectId?: Map<string, string | null>;
};

export type HandleAutoAdvanceEventResult =
  | { launched: true; launchAgent: string }
  | { launched: false; reason: string };

export async function handleAutoAdvanceEvent({
  event,
  launchAgent,
  localWorkingDirectoryByProjectId
}: HandleAutoAdvanceEventInput): Promise<HandleAutoAdvanceEventResult> {
  const objectiveId = getAutoAdvanceObjectiveId(event);
  if (!objectiveId) {
    return { launched: false, reason: 'missing_objective_id' };
  }

  const supabase = createClient();
  const { data: ticket, error: ticketError } = await supabase
    .from('tickets')
    .select('id,ticket_id,organization_id,project_id,execution_target')
    .eq('id', event.ticket_id)
    .maybeSingle();

  if (ticketError || !ticket) {
    return { launched: false, reason: 'ticket_not_found' };
  }

  if (ticket.execution_target !== 'agent') {
    return { launched: false, reason: 'not_agent_ticket' };
  }

  const { data: objective, error: objectiveError } = await supabase
    .from('objectives')
    .select('id,state,auto_advanced_at,assigned_agent')
    .eq('id', objectiveId)
    .eq('ticket_id', event.ticket_id)
    .maybeSingle();

  if (objectiveError || !objective) {
    return { launched: false, reason: 'objective_not_found' };
  }

  if (objective.state !== 'submitted' || !objective.auto_advanced_at) {
    return { launched: false, reason: 'objective_not_auto_advanced' };
  }

  const { data: activeSession } = await supabase
    .from('agent_sessions')
    .select('id,session_state')
    .eq('ticket_id', event.ticket_id)
    .in('session_state', ['attached', 'blocked', 'idle'])
    .order('attached_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (activeSession) {
    return { launched: false, reason: 'session_already_active' };
  }

  const {
    data: { user }
  } = await supabase.auth.getUser();
  const agentFlags = user ? await fetchAgentFlagsByUserId(supabase, user.id) : {};

  const assigned = resolveAssignedAgentFromAutoAdvancePayload(
    event.payload,
    objective.assigned_agent
  );
  const launchAgentType = resolveLaunchAgentForAutoAdvance(assigned);
  const projectWorkingDirectory = ticket.project_id
    ? (localWorkingDirectoryByProjectId?.get(ticket.project_id) ?? null)
    : null;

  const context: AutoAdvanceLaunchContext = {
    launchTicketId: ticket.ticket_id || ticket.id,
    organizationId: ticket.organization_id,
    projectId: ticket.project_id,
    cwd: resolveWorkingDirectoryFromProject(projectWorkingDirectory),
    agentFlags,
    assigned
  };

  const params = buildAutoAdvanceLaunchParams({ context, launchAgent: launchAgentType });

  try {
    await launchAgent(params);
    const ticketReference = getTicketIdentifier(ticket);
    if (typeof window !== 'undefined') {
      void window.electronAPI?.app?.notify(
        `Auto-advanced (${ticketReference})`,
        'Launching the next objective in a new terminal.'
      );
    }
    return { launched: true, launchAgent: launchAgentType };
  } catch (error) {
    console.error('[auto-advance] Failed to launch agent:', error);
    throw error;
  }
}
