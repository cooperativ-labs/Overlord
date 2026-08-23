import { Outlet, useNavigate, useParams } from '@tanstack/react-router';

import { ActivityFeed } from '@/components/activity-feed/ActivityFeed.tsx';
import { MissionDrawer } from '@/components/MissionDrawer.tsx';
import { MissionPanel } from '@/components/MissionPanel.tsx';
import { ProjectWorkspaceErrorBoundary } from '@/components/ProjectWorkspaceErrorBoundary.tsx';

/**
 * Dedicated Feed surface: cross-workspace objective activity, with the mission
 * panel in a nested drawer so a running objective can be opened without leaving
 * for its project board.
 */
export function FeedPage() {
  const navigate = useNavigate();

  return (
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <main className="flex min-h-0 min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
        <ProjectWorkspaceErrorBoundary region="activity feed">
          <ActivityFeed
            onOpenMission={({ missionId, objectiveDisplayId }) =>
              void navigate({
                to: '/feed/missions/$missionId',
                params: { missionId },
                search: objectiveDisplayId ? { objective: objectiveDisplayId } : {}
              })
            }
          />
        </ProjectWorkspaceErrorBoundary>
      </main>
      <ProjectWorkspaceErrorBoundary region="mission panel">
        <Outlet />
      </ProjectWorkspaceErrorBoundary>
    </div>
  );
}

/** The mission panel opened from an activity-feed card; closes back to `/feed`. */
export function FeedMissionPanelRoute() {
  const { missionId } = useParams({ from: '/feed/missions/$missionId' });
  const navigate = useNavigate();
  return (
    <MissionDrawer>
      <MissionPanel
        projectId=""
        missionId={missionId}
        onClose={() => void navigate({ to: '/feed' })}
        onProjectChanged={() =>
          void navigate({ to: '/feed/missions/$missionId', params: { missionId } })
        }
      />
    </MissionDrawer>
  );
}
