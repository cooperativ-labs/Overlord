'use client';

// Hidden Phase 2 hydration component.
//
// Rendered invisibly alongside the existing Kanban/List/Calendar views so the
// bootstrap data surfaces into the TanStack Query cache without changing the
// rendered UI. Components that opt into the cache (Phase 3+) can read from it
// via `useTicketBoard` and friends with the same scope, getting instant data
// and no duplicate fetches. In development, logs the hydrated shape once so we
// can eyeball correctness.

import { useEffect } from 'react';

import type { SidebarProject } from '@/lib/actions/project-types';

import type { BoardBootstrap, BoardDataset, BoardScope, BoardStatus } from './board-types';
import { useProjects, useTicketBoard, useTicketStatuses } from './hooks';

/** Stable fallback so `useProjects` does not see a new `initialData` reference every render. */
const EMPTY_PROJECTS: SidebarProject[] = [];

export type BoardHydrationBoundaryProps = {
  scope: BoardScope;
  bootstrap: BoardBootstrap;
  statuses: BoardStatus[];
  dataset?: BoardDataset;
  organizationId?: number;
  projects?: SidebarProject[];
};

export default function BoardHydrationBoundary({
  scope,
  bootstrap,
  statuses,
  dataset = 'board',
  organizationId,
  projects
}: BoardHydrationBoundaryProps) {
  const boardQuery = useTicketBoard(scope, bootstrap, { dataset });
  const statusesQuery = useTicketStatuses(organizationId, statuses);
  const projectsQuery = useProjects(projects ?? EMPTY_PROJECTS);

  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return;
    // eslint-disable-next-line no-console
    console.debug('[client-data] board cache hydrated', {
      scope,
      ticketCount: Object.keys(boardQuery.data?.ticketsById ?? {}).length,
      statusCount: statusesQuery.data?.length ?? 0,
      projectCount: projectsQuery.data?.length ?? 0
    });
  }, [scope, boardQuery.data, statusesQuery.data, projectsQuery.data]);

  return null;
}
