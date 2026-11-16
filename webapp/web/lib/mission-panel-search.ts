/**
 * Mission-panel search used by desktop deep links and Feed cards.
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

/** The objective a `?objective=` ref names: display id first, then UUID (plan §9.1). */
export function findObjectiveByRef<T extends { id: string; displayId?: string | null }>(
  objectives: readonly T[],
  ref: string | undefined | null
): T | null {
  if (!ref) return null;
  return (
    objectives.find(objective => objective.displayId === ref) ??
    objectives.find(objective => objective.id === ref) ??
    null
  );
}

/** Search with the objective detail set to `ref`, keeping every other parameter. */
export function withObjectiveSearch(
  previous: Record<string, unknown>,
  ref: string
): Record<string, unknown> {
  return { ...previous, objective: ref };
}

/** Search with the objective detail cleared, keeping every other parameter. */
export function withoutObjectiveSearch(previous: Record<string, unknown>): Record<string, unknown> {
  const next = { ...previous };
  delete next.objective;
  return next;
}

/**
 * History-state marker on a detail entry this UI pushed on top of the mission-only entry. Only
 * such an entry may be closed with `history.back()`; a direct, copied or feed link has no
 * mission-only entry beneath it, so closing it replaces the URL instead (plan §9.1).
 */
export const OBJECTIVE_DETAIL_HISTORY_KEY = 'overlordObjectiveDetailPushed';

export function isLocallyPushedObjectiveDetail(state: unknown): boolean {
  return Boolean(
    state &&
    typeof state === 'object' &&
    (state as Record<string, unknown>)[OBJECTIVE_DETAIL_HISTORY_KEY] === true
  );
}
