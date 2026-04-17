// Centralized TanStack Query keys for the ticket board cache.
//
// All keys are plain serializable arrays so TanStack Query can compare them
// structurally across renders without any custom equality. Callers should go
// through the helpers rather than inlining key arrays to keep invalidation
// call-sites greppable.

import type { BoardScope } from './board-types';

export const ticketQueryKeys = {
  all: ['tickets'] as const,

  board: (scope: BoardScope) => {
    if (scope.kind === 'project') {
      return [
        'tickets',
        'board',
        'project',
        scope.projectId,
        scope.organizationId ?? null
      ] as const;
    }
    return ['tickets', 'board', 'user', scope.organizationId ?? null] as const;
  },

  statuses: (organizationId?: number) => ['tickets', 'statuses', organizationId ?? null] as const,

  ticketById: (ticketId: string) => ['tickets', 'detail', ticketId] as const,

  ticketEvents: (ticketId: string) => ['tickets', 'detail', ticketId, 'events'] as const,

  ticketObjectives: (ticketId: string) => ['tickets', 'detail', ticketId, 'objectives'] as const,

  ticketArtifacts: (ticketId: string) => ['tickets', 'detail', ticketId, 'artifacts'] as const,

  ticketFileChanges: (ticketId: string) => ['tickets', 'detail', ticketId, 'file-changes'] as const,

  ticketSharedState: (ticketId: string) => ['tickets', 'detail', ticketId, 'shared-state'] as const,

  ticketSession: (ticketId: string) => ['tickets', 'detail', ticketId, 'session'] as const,

  projects: () => ['projects'] as const
} as const;

export type TicketBoardQueryKey = ReturnType<typeof ticketQueryKeys.board>;
export type TicketStatusesQueryKey = ReturnType<typeof ticketQueryKeys.statuses>;
export type ProjectsQueryKey = ReturnType<typeof ticketQueryKeys.projects>;
