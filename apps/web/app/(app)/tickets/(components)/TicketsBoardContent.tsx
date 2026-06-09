import { headers } from 'next/headers';

import { getGlobalListViewPreferencesAction } from '@/lib/actions/global-list-view-preferences';
import { getProjectUserPreferencesAction } from '@/lib/actions/project-user-preferences';
import { getScheduledTicketVisibilityDaysForUser } from '@/lib/actions/scheduled-ticket-visibility-preference';
import { loadTicketBoardSnapshot } from '@/lib/actions/tickets/board-snapshot';
import { getRawViewPreference } from '@/lib/actions/view-preference';
import type { BoardScope, BoardStatus } from '@/lib/client-data/tickets/board-types';
import { listProjectFiles, resolveLinkedDirectory } from '@/lib/filesystem/project-file-tree';
import { getScheduledTicketVisibilityWindow } from '@/lib/helpers/scheduled-ticket-visibility';
import { getPrimaryProjectResourceDirectoriesByProjectId } from '@/lib/resource-directories/primary-resource';
import { createClientForRequest } from '@/supabase/utils/server';

import TicketsBoardClient from './TicketsBoardClient';

function toLoadError(error: unknown): { message: string } | null {
  if (!error) {
    return null;
  }

  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.length > 0) {
      return { message };
    }
  }

  return { message: 'Failed to load tickets' };
}

type TicketsBoardContentProps = {
  organizationId?: number;
  showOrganizationName?: boolean;
  projectId?: string;
  mentionProjectId?: string;
};

export default async function TicketsBoardContent({
  organizationId,
  showOrganizationName = false,
  projectId,
  mentionProjectId
}: TicketsBoardContentProps) {
  const savedView = await getRawViewPreference();
  const headerStore = await headers();
  const ua = headerStore.get('user-agent') ?? '';
  const isMobile = /mobile|android|iphone/i.test(ua);
  const isElectronRequest = /electron/i.test(ua);

  const [projectPreferences, globalListPrefs] = await Promise.all([
    projectId ? getProjectUserPreferencesAction(projectId) : null,
    !projectId ? getGlobalListViewPreferencesAction() : null
  ]);

  const preferredView = projectPreferences?.preferred_view ?? savedView;
  // This is the initial view the client will show. Mobile can only show list or calendar.
  const initialView = isMobile
    ? preferredView === 'calendar'
      ? 'calendar'
      : 'list'
    : (preferredView ?? 'board');
  const initialHiddenColumns = projectPreferences?.hidden_columns ?? [];
  const initialListFilters = projectPreferences?.list_filters ?? null;
  const initialCollapsedStatuses =
    projectPreferences?.list_collapsed_statuses ?? globalListPrefs?.list_collapsed_statuses ?? [];
  const initialStatusOrder =
    projectPreferences?.list_status_order ?? globalListPrefs?.list_status_order ?? [];
  const supabase = await createClientForRequest();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  const scheduledVisibilityDays = user
    ? await getScheduledTicketVisibilityDaysForUser(supabase, user.id)
    : 0;
  const scheduledWindow = getScheduledTicketVisibilityWindow(scheduledVisibilityDays);

  // Board/list data is loaded through the same snapshot loader the client
  // refetch action uses, so SSR and background refetches cannot drift.
  // Calendar data is fetched client-side on demand via TanStack Query.
  const snapshot = await loadTicketBoardSnapshot(supabase, {
    organizationId,
    projectId,
    dataset: 'board',
    scheduledWindow,
    userId: user?.id ?? null
  });

  const statuses = snapshot.statuses;
  const tickets = snapshot.tickets;
  const loadError = toLoadError(snapshot.ticketsError) ?? toLoadError(snapshot.statusesError);
  let objectiveFileMentionPaths: string[] = [];
  let kanbanWorkingDirectory: string | null = null;

  // Only resolve file mentions when the board view will be shown — it's a
  // board-specific feature and the listing can take up to 3 seconds.
  const effectiveMentionProjectId = projectId ?? mentionProjectId;
  if (effectiveMentionProjectId && initialView === 'board') {
    const primaryResources = user
      ? await getPrimaryProjectResourceDirectoriesByProjectId(supabase, {
          userId: user.id,
          projectIds: [effectiveMentionProjectId]
        })
      : new Map();
    const primaryDirectory = primaryResources.get(effectiveMentionProjectId)?.directoryPath ?? null;

    if (isElectronRequest) {
      kanbanWorkingDirectory = primaryDirectory;
    } else {
      const resolvedProjectDirectory = resolveLinkedDirectory(primaryDirectory);
      if (resolvedProjectDirectory) {
        kanbanWorkingDirectory = resolvedProjectDirectory;
        try {
          const result = await Promise.race([
            listProjectFiles(resolvedProjectDirectory),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('File listing timed out')), 3000)
            )
          ]);
          objectiveFileMentionPaths = result.files;
        } catch {
          // Non-fatal: file mentions will be unavailable
        }
      }
    }
  }

  const boardScope: BoardScope = projectId
    ? { kind: 'project', projectId, organizationId }
    : { kind: 'user', organizationId };

  const boardBootstrapStatuses: BoardStatus[] = statuses.map(status => ({
    name: status.name,
    position: status.position,
    status_type: status.status_type
  }));

  const completeStatusName =
    statuses.find(
      status =>
        status.status_type === 'complete' && status.name.trim().toLowerCase() !== 'cancelled'
    )?.name ?? statuses.find(status => status.status_type === 'complete')?.name;

  return (
    <TicketsBoardClient
      initialView={initialView}
      organizationId={organizationId}
      projectId={projectId}
      showOrganizationName={showOrganizationName}
      tickets={tickets}
      statuses={statuses}
      boardScope={boardScope}
      boardBootstrapStatuses={boardBootstrapStatuses}
      columnPageInfo={snapshot.columnPageInfo}
      loadError={loadError}
      fileMentionPaths={objectiveFileMentionPaths}
      workingDirectory={kanbanWorkingDirectory}
      initialHiddenColumns={initialHiddenColumns}
      initialListFilters={initialListFilters}
      initialCollapsedStatuses={initialCollapsedStatuses}
      initialStatusOrder={initialStatusOrder}
      scheduledVisibilityDays={scheduledVisibilityDays}
      ticketUrlBase={projectId ? `/projects/${projectId}` : '/u'}
      completeStatusName={completeStatusName}
    />
  );
}
