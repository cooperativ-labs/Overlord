// Shared aggregation of per-ticket board indicators (objectives, agent
// sessions, waiting questions). Used by the server bootstrap, server actions,
// and the client realtime reconciler so all paths derive identical state.
//
// Framework-free: no React, Supabase, or Next.js imports.

import { isDraftObjectiveWithText } from '@/lib/helpers/tickets';

// Event types that put a ticket into the "waiting on human" state. Every query
// for waiting indicators must use this list so bootstrap, refetch, and
// realtime reconciliation agree.
export const WAITING_TICKET_EVENT_TYPES = ['question', 'awaiting_approval'] as const;

export type ObjectiveAggregationRow = {
  ticket_id: string;
  state: string | null;
  objective: string | null;
  agent_identifier: string | null;
  assigned_agent: unknown;
};

export type TicketObjectiveAggregate = {
  // agent_identifier of the most recently created objective.
  latestObjectiveAgent: string | null;
  // assigned_agent of the most recently created objective that has one. Empty
  // drafts inherit from the prior objective, so nulls must not shadow it.
  latestAssignedAgent: unknown | null;
  // agent_identifier of the most recently created executing objective.
  executingObjectiveAgent: string | null;
  hasExecutingObjective: boolean;
  executedObjectivesCount: number;
  hasDraftObjectiveWithText: boolean;
};

/**
 * Aggregate objective rows into per-ticket board indicators.
 * Rows MUST be ordered by created_at descending (newest first).
 */
export function aggregateObjectivesByTicket(
  rows: ObjectiveAggregationRow[]
): Map<string, TicketObjectiveAggregate> {
  const byTicket = new Map<string, TicketObjectiveAggregate>();

  for (const row of rows) {
    let aggregate = byTicket.get(row.ticket_id);
    if (!aggregate) {
      aggregate = {
        latestObjectiveAgent: row.agent_identifier ?? null,
        latestAssignedAgent: null,
        executingObjectiveAgent: null,
        hasExecutingObjective: false,
        executedObjectivesCount: 0,
        hasDraftObjectiveWithText: false
      };
      byTicket.set(row.ticket_id, aggregate);
    }
    if (aggregate.latestAssignedAgent === null && row.assigned_agent !== null) {
      aggregate.latestAssignedAgent = row.assigned_agent;
    }
    if (row.state === 'complete') {
      aggregate.executedObjectivesCount += 1;
    }
    if (isDraftObjectiveWithText(row)) {
      aggregate.hasDraftObjectiveWithText = true;
    }
    if (row.state === 'executing') {
      aggregate.hasExecutingObjective = true;
      if (row.agent_identifier && aggregate.executingObjectiveAgent === null) {
        aggregate.executingObjectiveAgent = row.agent_identifier;
      }
    }
  }

  return byTicket;
}

export type SessionAggregationRow = {
  session_state: string;
  agent_identifier: string | null;
};

/**
 * Index agent session rows (joined through objectives) by ticket id, keeping
 * only the most recent session per ticket.
 * Rows MUST be ordered by attached_at descending (newest first).
 */
export function indexLatestSessionByTicket<T extends SessionAggregationRow>(
  sessions: Array<T & { objective: { ticket_id: string } | Array<{ ticket_id: string }> | null }>
): Map<string, T> {
  const byTicket = new Map<string, T>();
  for (const session of sessions) {
    const objective = Array.isArray(session.objective) ? session.objective[0] : session.objective;
    const ticketId = objective?.ticket_id;
    if (!ticketId || byTicket.has(ticketId)) continue;
    byTicket.set(ticketId, session);
  }
  return byTicket;
}

/**
 * Index waiting-question events by ticket id, keeping the most recent
 * timestamp per ticket. Rows MUST be ordered by created_at descending.
 */
export function indexLatestWaitingByTicket(
  rows: Array<{ ticket_id: string; created_at: string }>
): Map<string, string> {
  const byTicket = new Map<string, string>();
  for (const row of rows) {
    if (!byTicket.has(row.ticket_id)) {
      byTicket.set(row.ticket_id, row.created_at);
    }
  }
  return byTicket;
}

/**
 * The agent shown as "running" on a card: an executing objective's agent wins,
 * otherwise the agent of an attached session.
 */
export function resolveRunningAgent(
  aggregate: Pick<TicketObjectiveAggregate, 'executingObjectiveAgent'> | undefined,
  session: SessionAggregationRow | undefined
): string | null {
  if (aggregate?.executingObjectiveAgent) return aggregate.executingObjectiveAgent;
  if (session?.session_state === 'attached') return session.agent_identifier ?? null;
  return null;
}
