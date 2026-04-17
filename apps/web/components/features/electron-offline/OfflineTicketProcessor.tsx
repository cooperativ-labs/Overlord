'use client';

import { useEffect, useRef } from 'react';
import { toast } from 'sonner';

import { useDefaultProject } from '@/components/features/projects/DefaultProjectContext';
import { useCreateTicketMutation } from '@/lib/client-data/tickets/mutations';
import { useOnlineStatus } from '@/lib/hooks/use-online-status';
import { getQueuedTickets, removeQueuedTicket } from '@/lib/offline/offline-ticket-queue';

/**
 * Invisible component that processes offline-queued tickets once the app
 * comes back online. Place inside the authenticated app shell.
 */
export function OfflineTicketProcessor() {
  const { isOnline } = useOnlineStatus();
  const { projects } = useDefaultProject();
  const createTicketMutation = useCreateTicketMutation();
  const createTicketMutationRef = useRef(createTicketMutation);
  const processingRef = useRef(false);

  useEffect(() => {
    createTicketMutationRef.current = createTicketMutation;
  }, [createTicketMutation]);

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
          const project = projects.find(item => item.id === ticket.projectId) ?? null;
          const organizationId = ticket.organizationId ?? project?.organizationId;
          await createTicketMutationRef.current.mutateAsync({
            optimisticTicket: {
              id: ticket.id,
              title: ticket.objective.slice(0, 80),
              objective: ticket.objective,
              organization_id: organizationId ?? 0,
              project_id: ticket.projectId,
              project_name: project?.name ?? ticket.projectName,
              project_color: project?.color ?? ticket.projectColor ?? null,
              project_everhour_project_id: null,
              everhour_task_id: null,
              agent_session_state: null,
              status: 'draft',
              priority: 'medium',
              execution_target: 'agent',
              assigned_agent: null,
              board_position: 0,
              waiting_for_response_at: null,
              has_unopened_waiting_response: false,
              is_read: true
            },
            status: 'draft',
            objective: ticket.objective,
            organizationId,
            projectId: ticket.projectId,
            placement: 'top'
          });
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
  }, [isOnline, projects]);

  return null;
}
