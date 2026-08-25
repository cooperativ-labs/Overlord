function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Reduces Run Queue state to the fields an agent needs to plan and verify entry ordering. */
export function compactRunQueueResponse(value: unknown): unknown {
  if (!isRecord(value) || !Array.isArray(value.queues)) return value;
  return {
    projectId: value.projectId,
    queues: value.queues.map(queue => {
      if (!isRecord(queue)) return queue;
      return {
        id: queue.id,
        name: queue.name,
        isDefault: queue.isDefault,
        paused: queue.paused,
        entries: Array.isArray(queue.entries)
          ? queue.entries.map(entry => {
              if (!isRecord(entry)) return entry;
              return {
                position: entry.position,
                state: entry.state,
                objectiveDisplayId: entry.objectiveDisplayId,
                objectiveTitle: entry.objectiveTitle,
                missionTitle: entry.missionTitle,
                blockedReason: entry.blockedReason,
                // A `waiting` hold clears by itself; without these an agent
                // reads "not dispatched" and cannot tell why or for how long.
                waitingReason: entry.waitingReason,
                waitingOnObjectiveDisplayId: entry.waitingOnObjectiveDisplayId
              };
            })
          : []
      };
    })
  };
}
