'use client';

import type { QueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { removeTicketFromBoards } from '@/lib/client-data/tickets/cache';
import {
  TICKET_DELETED_EVENT,
  type TicketDeletedEventDetail
} from '@/lib/helpers/ticket-board-events';
import {
  getOpenedWaitingTimestamps,
  getWaitingRaisedWhileOpenMap,
  hasUnopenedTimestamp,
  type TicketOpenedTimestamps,
  type TicketRaisedWhileOpenMap
} from '@/lib/helpers/ticket-waiting-response';

import type { Ticket } from '@/types/tickets';
import { initAudioRefs, mergeWaitingByTicket, toWaitingByTicket } from './realtime-helpers';
import { setupRealtimeSubscriptions } from './realtime-subscriptions';

export function useTicketBoardRealtime({
  tickets,
  organizationId,
  projectId,
  queryClient,
  onTicketRemoved
}: {
  tickets: Ticket[];
  organizationId?: number;
  projectId?: string;
  queryClient: QueryClient;
  onTicketRemoved?: (ticketId: string) => void;
}) {
  const [waitingByTicket, setWaitingByTicket] = useState<Record<string, string>>(() =>
    toWaitingByTicket(tickets)
  );
  const [openedWaitingTimestamps, setOpenedWaitingTimestamps] = useState<TicketOpenedTimestamps>(
    () => getOpenedWaitingTimestamps()
  );
  const [waitingRaisedWhileOpen, setWaitingRaisedWhileOpen] = useState<TicketRaisedWhileOpenMap>(
    () => getWaitingRaisedWhileOpenMap()
  );

  const waitingSoundRef = useRef<HTMLAudioElement | null>(null);
  const reviewSoundRef = useRef<HTMLAudioElement | null>(null);
  const alertSoundRef = useRef<HTMLAudioElement | null>(null);
  const waitingByTicketRef = useRef(waitingByTicket);
  const openTicketIdRef = useRef<string | null>(null);
  const ticketIdsRef = useRef<Set<string>>(new Set());
  const ticketsByIdRef = useRef<Map<string, Ticket>>(new Map());

  // Merge waiting indicators into the ticket list for rendering.
  const ticketsWithIndicators = useMemo(
    () =>
      tickets.map(ticket => {
        const waitingForResponseAt =
          waitingByTicket[ticket.id] ?? ticket.waiting_for_response_at ?? null;
        return {
          ...ticket,
          waiting_for_response_at: waitingForResponseAt,
          has_unopened_waiting_response:
            waitingRaisedWhileOpen[ticket.id] === true ||
            hasUnopenedTimestamp(waitingForResponseAt, openedWaitingTimestamps[ticket.id])
        };
      }),
    [openedWaitingTimestamps, tickets, waitingByTicket, waitingRaisedWhileOpen]
  );
  ticketIdsRef.current = new Set(tickets.map(ticket => ticket.id));
  ticketsByIdRef.current = new Map(ticketsWithIndicators.map(ticket => [ticket.id, ticket]));

  const removeTicketFromBoard = useCallback(
    (ticketId: string) => {
      removeTicketFromBoards(queryClient, ticketId);
      setWaitingByTicket(prev => {
        if (!(ticketId in prev)) return prev;
        const next = { ...prev };
        delete next[ticketId];
        return next;
      });
      onTicketRemoved?.(ticketId);
    },
    [onTicketRemoved, queryClient]
  );

  useEffect(() => {
    waitingByTicketRef.current = waitingByTicket;
  }, [waitingByTicket]);

  // Handle ticket deleted events from other tabs / components.
  useEffect(() => {
    const handleTicketDeleted = (event: Event) => {
      const ticketId = (event as CustomEvent<TicketDeletedEventDetail>).detail?.ticketId;
      if (!ticketId) return;
      removeTicketFromBoard(ticketId);
    };

    window.addEventListener(TICKET_DELETED_EVENT, handleTicketDeleted);
    return () => window.removeEventListener(TICKET_DELETED_EVENT, handleTicketDeleted);
  }, [removeTicketFromBoard]);

  // Initialise notification audio elements once.
  useEffect(() => {
    const { waitingAudio, reviewAudio, alertAudio } = initAudioRefs();
    waitingSoundRef.current = waitingAudio;
    reviewSoundRef.current = reviewAudio;
    alertSoundRef.current = alertAudio;

    return () => {
      waitingSoundRef.current = null;
      reviewSoundRef.current = null;
      alertSoundRef.current = null;
    };
  }, []);

  // Wire up Supabase realtime channels, DOM listeners, and polling.
  useEffect(() => {
    return setupRealtimeSubscriptions({
      organizationId,
      projectId,
      queryClient,
      removeTicketFromBoard,
      refs: {
        waitingByTicketRef,
        openTicketIdRef,
        ticketIdsRef,
        ticketsByIdRef,
        waitingSoundRef,
        reviewSoundRef,
        alertSoundRef
      },
      setters: {
        setWaitingByTicket,
        setOpenedWaitingTimestamps,
        setWaitingRaisedWhileOpen
      }
    });
  }, [organizationId, projectId, queryClient, removeTicketFromBoard]);

  const mergeWaitingFromLoadedTickets = useCallback((incoming: Ticket[]) => {
    if (incoming.length === 0) return;
    setWaitingByTicket(prev => mergeWaitingByTicket(prev, incoming));
  }, []);

  return {
    ticketsWithIndicators,
    waitingByTicket,
    openedWaitingTimestamps,
    waitingRaisedWhileOpen,
    setOpenedWaitingTimestamps,
    setWaitingRaisedWhileOpen,
    openTicketIdRef,
    ticketIdsRef,
    ticketsByIdRef,
    removeTicketFromBoard,
    mergeWaitingFromLoadedTickets
  };
}
