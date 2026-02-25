'use client';

import { type ComponentProps, createContext, useContext, useState } from 'react';

import { useElectron } from '@/components/features/terminal/useElectron';
import { getAgentTypeByIdentifier, type LaunchAgentTypeValue } from '@/lib/helpers/agent-types';
import { useTicketRealtime } from '@/lib/hooks/use-ticket-realtime';
import type { Database } from '@/types/database.types';

import { AgentSplitButton } from './AgentSplitButton';
import { CopyTicketPromptButton } from './CopyTicketPromptButton';

type TicketEvent = Database['public']['Tables']['ticket_events']['Row'];
type Artifact = Database['public']['Tables']['artifacts']['Row'];
type AgentSession = Database['public']['Tables']['agent_sessions']['Row'];
type SharedState = Database['public']['Tables']['shared_state']['Row'];

type TicketLiveState = {
  events: TicketEvent[];
  artifacts: Artifact[];
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
  initialEvents: TicketEvent[];
  initialArtifacts: Artifact[];
  initialSession: AgentSession | null;
  initialSharedState: SharedState[];
};

export function TicketLiveProvider({
  children,
  ticketId,
  initialEvents,
  initialArtifacts,
  initialSession,
  initialSharedState
}: TicketLiveProviderProps) {
  const liveState = useTicketRealtime({
    ticketId,
    initialEvents,
    initialArtifacts,
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
  defaultAgent?: LaunchAgentTypeValue;
};

export function AgentSplitButtonLive({
  defaultAgent = 'claude',
  ...props
}: AgentSplitButtonLiveProps) {
  const { session } = useTicketLive();
  const { isElectron } = useElectron();
  const [selectedAgent, setSelectedAgent] = useState<LaunchAgentTypeValue>(defaultAgent);

  if (!isElectron) {
    return (
      <CopyTicketPromptButton ticketId={props.ticketId} runInTerminal={false} variant="default" />
    );
  }

  return (
    <AgentSplitButton
      {...props}
      selectedAgent={selectedAgent}
      onSelectAgent={setSelectedAgent}
      agentSessionState={session?.session_state ?? null}
      activeAgentIdentifier={session?.agent_identifier ?? null}
    />
  );
}
