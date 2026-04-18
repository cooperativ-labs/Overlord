import type { SidebarProject } from '@/lib/actions/projects';
import { getProjectsForCurrentUser } from '@/lib/actions/projects';
import { getTicketBoardBootstrapAction, getTicketStatusesAction } from '@/lib/actions/tickets';

import type { BoardBootstrap, BoardDataset, BoardScope, BoardStatus } from './board-types';

export type BoardFetcher = (scope: BoardScope, dataset?: BoardDataset) => Promise<BoardBootstrap>;
export type StatusesFetcher = (organizationId?: number) => Promise<BoardStatus[]>;
export type ProjectsFetcher = () => Promise<SidebarProject[]>;

export const defaultBoardFetcher: BoardFetcher = (scope, dataset) =>
  getTicketBoardBootstrapAction(scope, dataset);

export const defaultStatusesFetcher: StatusesFetcher = organizationId =>
  getTicketStatusesAction(organizationId);

export const defaultProjectsFetcher: ProjectsFetcher = () => getProjectsForCurrentUser();
