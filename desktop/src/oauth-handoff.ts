const TICKET_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
const MISSION_ID_PATTERN = /^[A-Za-z0-9:_-]{1,64}$/;
/**
 * `coo:756.k7xm` — a mission display id, a dot, and the objective's display key.
 * The dot is deliberately part of the charset (coo:756 §9.6) so an objective id
 * survives a deep link without percent-encoding.
 */
const OBJECTIVE_DISPLAY_ID_PATTERN = /^([A-Za-z0-9:_-]{1,64})\.([A-Za-z0-9]{1,16})$/;

/** Where a mission/objective deep link should land in the shell. */
export type MissionDeepLinkTarget = {
  missionId: string;
  /** Objective display id when the link named one, else `null`. */
  objectiveDisplayId: string | null;
};

/** Parse only the exact custom URL the desktop OAuth callback is allowed to open. */
export function parseDesktopOAuthHandoffUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'overlord:' ||
      url.hostname !== 'auth' ||
      url.pathname !== '/callback' ||
      url.username ||
      url.password ||
      url.port ||
      url.hash
    ) {
      return null;
    }
    const ticket = url.searchParams.get('ticket');
    return ticket && TICKET_PATTERN.test(ticket) ? ticket : null;
  } catch {
    return null;
  }
}

/**
 * Parse only the credential-free mission/objective URLs owned by the desktop shell.
 *
 * Two forms are accepted, both of which resolve to a mission route:
 * `overlord://missions/<missionId>` and `overlord://objectives/<objectiveDisplayId>`.
 * The second is self-describing — an objective display id carries its mission
 * display id as a prefix — so the shell never has to call the backend to route.
 * An objective **UUID** is deliberately not accepted here: it cannot be resolved
 * to a mission without a lookup, and silently dropping it would repeat the
 * coo:502 bug.
 */
export function parseMissionDeepLink(value: string): MissionDeepLinkTarget | null {
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'overlord:' ||
      (url.hostname !== 'missions' && url.hostname !== 'objectives') ||
      url.port ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    const id = url.pathname.slice(1);
    if (value !== `overlord://${url.hostname}/${id}`) return null;

    const objective = OBJECTIVE_DISPLAY_ID_PATTERN.exec(id);
    if (objective) return { missionId: objective[1], objectiveDisplayId: id };
    if (url.hostname === 'objectives') return null;
    return MISSION_ID_PATTERN.test(id) ? { missionId: id, objectiveDisplayId: null } : null;
  } catch {
    return null;
  }
}
