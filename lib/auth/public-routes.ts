export const SESSION_ENDED_MESSAGE = 'You have been signed out. Please sign in again.';

const PUBLIC_EXACT_PATHS = new Set(['/', '/early-access', '/docs']);
const PUBLIC_PATH_PREFIXES = [
  '/docs/',
  '/login',
  '/signup',
  '/electron-login',
  '/confirm-email',
  '/onboarding',
  '/oauth/',
  '/oauth/consent',
  '/oauth/confirmation',
  '/auth',
  '/api/health',
  '/.well-known/',
  '/privacy',
  '/terms',
  '/api/auth',
  '/callback',
  '/demo'
];

export function isPublicRoute(pathname: string): boolean {
  return (
    PUBLIC_EXACT_PATHS.has(pathname) || PUBLIC_PATH_PREFIXES.some(path => pathname.startsWith(path))
  );
}
