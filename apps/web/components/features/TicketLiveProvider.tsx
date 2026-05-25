'use client';

import { type ComponentProps, createContext, useContext, useState } from 'react';

import { readDefaultAgentTriggerFromStorage } from '@/lib/helpers/agent-trigger';
import { type AgentSelectorValue } from '@/lib/helpers/agent-types';
import type { TicketAssignedAgent } from '@/types/tickets';
import { useTicketRealtime } from '@/lib/hooks/use-ticket-realtime';
import type { Database } from '@/types/database.types';

import { AgentSplitButton } from './AgentSplitButton';

type TicketEvent = Database['public']['Tables']['ticket_events']['Row'];
type Artifact = Database['public']['Tables']['artifacts']['Row'];
type AgentSession = Database['public']['Tables']['agent_sessions']['Row'];
type FileChange = Database['public']['Tables']['file_changes']['Row'];
type SharedState = Database['public']['Tables']['shared_state']['Row'];

type TicketLiveState = {
  events: TicketEvent[];
  artifacts: Artifact[];
  fileChanges: FileChange[];
  session: AgentSession | null;
  sharedState: SharedState[];
};

const TicketLiveContext = createContext<TicketLiveState | null>(null);

export function useTicketLive(): TicketLiveState {
  const ctx = useContext(TicketLiveContext);
  if (!ctx) throw new Error('useTicketLive must be used within TicketLiveProvider');
  return ctx;
}

type TicketLiveProviderProps = {
  children: React.ReactNode;
  ticketId: string;
  ticketReference?: string;
  initialEvents: TicketEvent[];
  initialArtifacts: Artifact[];
  initialFileChanges: FileChange[];
  initialSession: AgentSession | null;
  initialSharedState: SharedState[];
};

export function TicketLiveProvider({
  children,
  ticketId,
  ticketReference,
  initialEvents,
  initialArtifacts,
  initialFileChanges,
  initialSession,
  initialSharedState
}: TicketLiveProviderProps) {
  const liveState = useTicketRealtime({
    ticketId,
    ticketReference,
    initialEvents,
    initialArtifacts,
    initialFileChanges,
    initialSession,
    initialSharedState
  });

  return <TicketLiveContext.Provider value={liveState}>{children}</TicketLiveContext.Provider>;
}

// Connects AgentSplitButton to the live context — manages selected agent state locally
// and reads agentSessionState + activeAgentIdentifier from the live session.
type AgentSplitButtonLiveProps = Omit<
  ComponentProps<typeof AgentSplitButton>,
  'selectedAgent' | 'onSelectAgent' | 'agentSessionState' | 'activeAgentIdentifier'
> & {
  defaultAgent?: AgentSelectorValue;
  assignedSelection?: TicketAssignedAgent | null;
};

export function AgentSplitButtonLive({
  defaultAgent,
  assignedSelection,
  ...props
}: AgentSplitButtonLiveProps) {
  const { session } = useTicketLive();

  const [selectedAgent, setSelectedAgent] = useState<AgentSelectorValue>(
    defaultAgent ?? readDefaultAgentTriggerFromStorage()
  );

  return (
    <AgentSplitButton
      {...props}
      selectedAgent={selectedAgent}
      onSelectAgent={setSelectedAgent}
      assignedSelection={assignedSelection}
      agentSessionState={session?.session_state ?? null}
      activeAgentIdentifier={session?.agent_identifier ?? null}
    />
  );
}
