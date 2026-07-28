const TICKET_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
const MISSION_ID_PATTERN = /^[A-Za-z0-9:_-]{1,64}$/;

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

/** Parse only the credential-free mission URL owned by the desktop shell. */
export function parseMissionDeepLink(value: string): string | null {
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'overlord:' ||
      url.hostname !== 'missions' ||
      url.port ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    const missionId = url.pathname.slice(1);
    return MISSION_ID_PATTERN.test(missionId) && value === `overlord://missions/${missionId}`
      ? missionId
      : null;
  } catch {
    return null;
  }
}
