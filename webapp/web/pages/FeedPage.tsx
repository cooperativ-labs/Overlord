import { Outlet, useNavigate, useParams } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

import { ActivityFeed } from '@/components/activity-feed/ActivityFeed.tsx';
import { HumanActionsRail } from '@/components/activity-feed/HumanActionsRail.tsx';
import { MissionDrawer } from '@/components/MissionDrawer.tsx';
import { MissionPanel } from '@/components/MissionPanel.tsx';
import { ProjectWorkspaceErrorBoundary } from '@/components/ProjectWorkspaceErrorBoundary.tsx';

/** Relative labels in the rail advance on this cadence; the data arrives over realtime. */
const RAIL_TICK_MS = 30_000;

/**
 * Dedicated Feed surface: the human-actions rail on the left (coo:963), the
 * cross-workspace objective activity feed beside it, and the mission panel in
 * a nested drawer so a running objective can be opened without leaving for its
 * project board.
 */
export function FeedPage() {
  const navigate = useNavigate();
  const [nowIso, setNowIso] = useState(() => new Date().toISOString());
  useEffect(() => {
    const timer = window.setInterval(() => setNowIso(new Date().toISOString()), RAIL_TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  const openMission = ({
    missionId,
    objectiveDisplayId
  }: {
    missionId: string;
    objectiveDisplayId?: string | null;
  }) =>
    void navigate({
      to: '/feed/missions/$missionId',
      params: { missionId },
      search: objectiveDisplayId ? { objective: objectiveDisplayId } : {}
    });

  return (
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <ProjectWorkspaceErrorBoundary region="human actions">
        <HumanActionsRail nowIso={nowIso} onOpenMission={openMission} />
      </ProjectWorkspaceErrorBoundary>
      <main className="flex min-h-0 min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
        <ProjectWorkspaceErrorBoundary region="activity feed">
          <ActivityFeed onOpenMission={openMission} />
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
