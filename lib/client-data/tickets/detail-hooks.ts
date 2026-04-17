'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import type { Database } from '@/types/database.types';

import type { BoardTicket } from './board-types';
import { ticketQueryKeys } from './query-keys';

type TicketEvent = Database['public']['Tables']['ticket_events']['Row'];
type Objective = Database['public']['Tables']['objectives']['Row'];
type Artifact = Database['public']['Tables']['artifacts']['Row'];
type FileChange = Database['public']['Tables']['file_changes']['Row'];
type SharedState = Database['public']['Tables']['shared_state']['Row'];
type AgentSession = Database['public']['Tables']['agent_sessions']['Row'];

function staticQuery<T>(data: T): () => Promise<T> {
  return async () => data;
}

export function useTicketDetail(
  ticketId: string,
  initialData: BoardTicket | null = null
): UseQueryResult<BoardTicket | null, Error> {
  return useQuery({
    queryKey: ticketQueryKeys.ticketById(ticketId),
    queryFn: staticQuery(initialData),
    initialData,
    staleTime: 30_000,
    refetchOnMount: false
  });
}

export function useTicketEvents(
  ticketId: string,
  initialData: TicketEvent[] = []
): UseQueryResult<TicketEvent[], Error> {
  return useQuery({
    queryKey: ticketQueryKeys.ticketEvents(ticketId),
    queryFn: staticQuery(initialData),
    initialData,
    staleTime: 30_000,
    refetchOnMount: false
  });
}

export function useTicketObjectives(
  ticketId: string,
  initialData: Objective[] = []
): UseQueryResult<Objective[], Error> {
  return useQuery({
    queryKey: ticketQueryKeys.ticketObjectives(ticketId),
    queryFn: staticQuery(initialData),
    initialData,
    staleTime: 30_000,
    refetchOnMount: false
  });
}

export function useTicketArtifacts(
  ticketId: string,
  initialData: Artifact[] = []
): UseQueryResult<Artifact[], Error> {
  return useQuery({
    queryKey: ticketQueryKeys.ticketArtifacts(ticketId),
    queryFn: staticQuery(initialData),
    initialData,
    staleTime: 30_000,
    refetchOnMount: false
  });
}

export function useTicketFileChanges(
  ticketId: string,
  initialData: FileChange[] = []
): UseQueryResult<FileChange[], Error> {
  return useQuery({
    queryKey: ticketQueryKeys.ticketFileChanges(ticketId),
    queryFn: staticQuery(initialData),
    initialData,
    staleTime: 30_000,
    refetchOnMount: false
  });
}

export function useTicketSharedState(
  ticketId: string,
  initialData: SharedState[] = []
): UseQueryResult<SharedState[], Error> {
  return useQuery({
    queryKey: ticketQueryKeys.ticketSharedState(ticketId),
    queryFn: staticQuery(initialData),
    initialData,
    staleTime: 30_000,
    refetchOnMount: false
  });
}

export function useTicketSession(
  ticketId: string,
  initialData: AgentSession | null = null
): UseQueryResult<AgentSession | null, Error> {
  return useQuery({
    queryKey: ticketQueryKeys.ticketSession(ticketId),
    queryFn: staticQuery(initialData),
    initialData,
    staleTime: 30_000,
    refetchOnMount: false
  });
}
