import {
  useEverhourIntegration,
  useProjectEverhour,
  useStartProjectTimer,
  useStopProjectTimer
} from '@/lib/queries';

import { useLiveSeconds } from '../../lib/everhour.ts';

/**
 * Shared timer state + start/stop control for one project's Everhour `general`
 * task. Returns `connected: false` when the acting user has not connected Everhour.
 */
export function useProjectTimerControls(projectId: string, options: { poll?: boolean } = {}) {
  const integration = useEverhourIntegration();
  const connected = integration.data?.connected ?? false;
  const everhour = useProjectEverhour(projectId, { enabled: connected, poll: options.poll });
  const start = useStartProjectTimer(projectId);
  const stop = useStopProjectTimer(projectId);

  const running = Boolean(everhour.data?.runningTimer);
  const baseSeconds = everhour.data?.runningTimer?.durationSeconds ?? 0;
  const liveSeconds = useLiveSeconds(baseSeconds, everhour.dataUpdatedAt, running);
  const busy = start.isPending || stop.isPending;

  const toggle = () => {
    if (busy) return;
    if (running) stop.mutate();
    else start.mutate();
  };

  return {
    connected,
    running,
    liveSeconds,
    busy,
    toggle,
    state: everhour.data,
    dataUpdatedAt: everhour.dataUpdatedAt
  };
}
