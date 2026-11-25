import {
  useEverhourIntegration,
  useMissionEverhour,
  useStartMissionTimer,
  useStopMissionTimer
} from '@/lib/queries';

import { useLiveSeconds } from '../../lib/everhour.ts';

/**
 * Shared timer state + start/stop control for one mission. Returns `connected:
 * false` when the acting user has not connected Everhour, so callers can render
 * nothing. `liveSeconds` ticks locally while the timer runs.
 */
export function useMissionTimerControls(missionId: string, options: { poll?: boolean } = {}) {
  const integration = useEverhourIntegration();
  const connected = integration.data?.connected ?? false;
  const everhour = useMissionEverhour(missionId, { enabled: connected, poll: options.poll });
  const start = useStartMissionTimer(missionId);
  const stop = useStopMissionTimer(missionId);

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
