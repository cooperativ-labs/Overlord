export const ELECTRON_CLIENT_HEADER = 'X-Overlord-Client';
export const ELECTRON_CLIENT_VALUE = 'desktop';
export const ELECTRON_UA_SUBSTRING = 'Overlord-Desktop/';

/**
 * Returns true when the request originates from the Electron desktop client.
 *
 * Primary signal: X-Overlord-Client: desktop header injected by the main
 * process header injector. UA substring match is a rollout fallback for
 * builds that predate the header injector.
 */
export function isElectronRequest(request: Request): boolean {
  const clientHeader = request.headers.get(ELECTRON_CLIENT_HEADER);
  if (clientHeader) {
    return clientHeader.toLowerCase() === ELECTRON_CLIENT_VALUE;
  }
  const ua = request.headers.get('user-agent') ?? '';
  return ua.includes(ELECTRON_UA_SUBSTRING);
}
