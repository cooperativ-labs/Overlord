import { readDefaultAgentTriggerFromStorage } from '@/lib/helpers/agent-trigger';
import { isLaunchAgentTypeValue, type LaunchAgentType } from '@/lib/helpers/agent-types';
import { isWorkingDirectoryNone } from '@/lib/helpers/project-working-directory';
import {
  parseObjectiveAssignedAgent,
  type TicketAssignedAgent
} from '@/lib/helpers/ticket-assigned-agent';
import type { Database, Json } from '@/types/database.types';
import type { LaunchTerminalAgentParams } from '@/types/electron';

type TicketEvent = Database['public']['Tables']['ticket_events']['Row'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseAgentFlags(config: Json | null | undefined): string[] {
  if (!isRecord(config)) return [];
  const flags = config.flags;
  if (!Array.isArray(flags)) return [];
  return flags.filter((flag): flag is string => typeof flag === 'string');
}

export function resolveAssignedAgentFromAutoAdvancePayload(
  payload: Json | null,
  fallback: Json | null
): TicketAssignedAgent | null {
  const record = isRecord(payload) ? payload : null;
  const assignedFromPayload = record
    ? parseObjectiveAssignedAgent(record.assigned_agent as Json)
    : null;
  if (assignedFromPayload) return assignedFromPayload;
  return parseObjectiveAssignedAgent(fallback);
}

export function resolveLaunchAgentForAutoAdvance(
  assigned: TicketAssignedAgent | null
): LaunchAgentType {
  if (assigned?.agent && isLaunchAgentTypeValue(assigned.agent)) {
    return assigned.agent;
  }
  return readDefaultAgentTriggerFromStorage();
}

export type AutoAdvanceLaunchContext = {
  launchTicketId: string;
  organizationId: number;
  projectId: string | null;
  cwd?: string;
  agentFlags?: Partial<Record<LaunchAgentType, string[]>>;
  assigned: TicketAssignedAgent | null;
};

export function buildAutoAdvanceLaunchParams({
  context,
  launchAgent
}: {
  context: AutoAdvanceLaunchContext;
  launchAgent: LaunchAgentType;
}): LaunchTerminalAgentParams {
  return {
    ticketId: context.launchTicketId,
    agent: launchAgent,
    organizationId: context.organizationId,
    cwd: context.cwd,
    launchMode: 'run',
    flags: context.agentFlags?.[launchAgent],
    model: context.assigned?.model ?? undefined,
    thinking: context.assigned?.thinking ?? undefined,
    projectId: context.projectId ?? undefined
  };
}

export function resolveWorkingDirectoryFromProject(
  localWorkingDirectory: string | null | undefined
): string | undefined {
  if (
    typeof localWorkingDirectory !== 'string' ||
    localWorkingDirectory.trim().length === 0 ||
    isWorkingDirectoryNone(localWorkingDirectory)
  ) {
    return undefined;
  }
  return localWorkingDirectory.trim();
}

export async function fetchAgentFlagsByUserId(
  supabase: ReturnType<typeof import('@/supabase/utils/client').createClient>,
  userId: string
): Promise<Partial<Record<LaunchAgentType, string[]>>> {
  const { data, error } = await supabase
    .from('user_agent_configs')
    .select('agent_type,config')
    .eq('user_id', userId);

  if (error || !data) return {};

  const flags: Partial<Record<LaunchAgentType, string[]>> = {};
  for (const row of data) {
    if (!isLaunchAgentTypeValue(row.agent_type)) continue;
    flags[row.agent_type] = parseAgentFlags(row.config);
  }
  return flags;
}

export function getAutoAdvanceObjectiveId(event: TicketEvent): string | null {
  if (event.objective_id) return event.objective_id;
  const payload = isRecord(event.payload) ? event.payload : null;
  const nextObjectiveId = payload?.next_objective_id;
  return typeof nextObjectiveId === 'string' ? nextObjectiveId : null;
}
