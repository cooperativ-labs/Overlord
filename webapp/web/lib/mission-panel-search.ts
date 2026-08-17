/**
 * Mission-panel search used by desktop deep links and Inbox feed cards.
 *
 * `?objective=coo:756.k7xm` keeps the SPA on the mission route (planning
 * surface) while naming the objective the live/activity surface pointed at
 * (coo:756 §9.6). A UUID is also accepted so an internal caller that already
 * has the row id does not have to mint a display id first.
 */
export type MissionPanelSearch = {
  objective?: string;
};

export function parseMissionPanelSearch(search: Record<string, unknown>): MissionPanelSearch {
  const raw = search.objective;
  if (typeof raw !== 'string') return {};
  const objective = raw.trim();
  return objective ? { objective } : {};
}

/** Router search is an object after validateSearch, a query string before it. */
export function objectiveSearchFromLocation(search: unknown): string | undefined {
  if (typeof search === 'string') {
    const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
    return parseMissionPanelSearch({ objective: params.get('objective') ?? '' }).objective;
  }
  if (search && typeof search === 'object') {
    return parseMissionPanelSearch(search as Record<string, unknown>).objective;
  }
  return undefined;
}

const DESKTOP_MISSION_ROUTE =
  /^\/user\/missions\/([A-Za-z0-9:_-]{1,64})(?:\?objective=([A-Za-z0-9:._-]{1,80}))?$/;

/** The only shell path desktop `onNavigate` is allowed to drive. */
export function parseDesktopMissionShellRoute(route: string): {
  missionId: string;
  objectiveDisplayId: string | null;
} | null {
  const match = DESKTOP_MISSION_ROUTE.exec(route);
  if (!match) return null;
  return { missionId: match[1], objectiveDisplayId: match[2] ?? null };
}

export function objectiveMatchesFocus({
  objective,
  focusRef
}: {
  objective: { id: string; displayId?: string | null };
  focusRef: string | undefined;
}): boolean {
  if (!focusRef) return false;
  return objective.displayId === focusRef || objective.id === focusRef;
}
