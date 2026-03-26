'use client';

import { useEffect, useRef } from 'react';
import { toast } from 'sonner';

import { createTicketInColumnAction } from '@/lib/actions/tickets';
import { useOnlineStatus } from '@/lib/hooks/use-online-status';
import { getQueuedTickets, removeQueuedTicket } from '@/lib/offline/offline-ticket-queue';

/**
 * Invisible component that processes offline-queued tickets once the app
 * comes back online. Place inside the authenticated app shell.
 */
export function OfflineTicketProcessor() {
  const { isOnline } = useOnlineStatus();
  const processingRef = useRef(false);

  useEffect(() => {
    if (!isOnline || processingRef.current) return;

    const queue = getQueuedTickets();
    if (queue.length === 0) return;

    processingRef.current = true;

    async function processQueue() {
      const tickets = getQueuedTickets();
      let submitted = 0;
      let failed = 0;

      for (const ticket of tickets) {
        try {
          await createTicketInColumnAction(
            'draft',
            ticket.objective,
            crypto.randomUUID(),
            undefined,
            ticket.projectId
          );
          removeQueuedTicket(ticket.id);
          submitted++;
        } catch (error) {
          console.error('Failed to submit offline ticket:', error);
          failed++;
        }
      }

      if (submitted > 0) {
        toast.success(
          `Submitted ${submitted} offline ticket${submitted !== 1 ? 's' : ''}${failed > 0 ? ` (${failed} failed)` : ''}`
        );
      } else if (failed > 0) {
        toast.error(`Failed to submit ${failed} offline ticket${failed !== 1 ? 's' : ''}`);
      }

      processingRef.current = false;
    }

    void processQueue();
  }, [isOnline]);

  return null;
}
